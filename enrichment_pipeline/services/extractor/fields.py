"""Rule-based (regex/keyword) structured-field extraction.

Deliberately not an LLM: every value written to the database must trace
back to an exact snippet of real source text that a human can verify, and
a fixed set of rules is what makes "never fabricate, write N/A if
unverifiable" actually enforceable rather than aspirational.

Money amounts are normalized to INR Crore (1 Cr = 1,00,00,000) since
that's the unit Indian financial disclosures are conventionally reported
in and it's what the ICP scorer's thresholds are expressed in.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

NA = "N/A"

# ------------------------------------------------------------------ #
# Money parsing
# ------------------------------------------------------------------ #
_CURRENCY_PREFIX = r"(?:Rs\.?|INR|₹)"
_NUMBER = r"[\d,]+(?:\.\d+)?"
_UNIT = r"(?:crore|cr\.?|lakh|lac|million|mn|billion|bn)"

# e.g. "Rs. 12.5 crore", "INR 45 Lakh", "₹120 million", "12.5 Cr"
_MONEY_RE = re.compile(
    rf"(?:{_CURRENCY_PREFIX}\s*)?({_NUMBER})\s*({_UNIT})\b",
    re.IGNORECASE,
)

_UNIT_TO_CR = {
    "crore": 1.0, "cr": 1.0, "cr.": 1.0,
    "lakh": 0.01, "lac": 0.01,
    "million": 0.1, "mn": 0.1,
    "billion": 100.0, "bn": 100.0,
}


@dataclass
class MoneyMatch:
    value_inr_cr: float
    raw_text: str
    span: tuple[int, int]


def find_money_near(text: str, center: int, window: int = 220) -> Optional[MoneyMatch]:
    """Search a window around `center` (a character offset into `text`)
    for the nearest plausible currency amount, preferring matches closest
    to the keyword that triggered the search."""
    start = max(0, center - window)
    end = min(len(text), center + window)
    segment = text[start:end]

    best: Optional[MoneyMatch] = None
    best_distance = None
    local_center = center - start
    for m in _MONEY_RE.finditer(segment):
        unit_key = m.group(2).lower().rstrip(".")
        multiplier = _UNIT_TO_CR.get(unit_key)
        if multiplier is None:
            continue
        try:
            raw_number = float(m.group(1).replace(",", ""))
        except ValueError:
            continue
        value_cr = round(raw_number * multiplier, 4)
        match_center = (m.start() + m.end()) // 2
        distance = abs(match_center - local_center)
        if best_distance is None or distance < best_distance:
            best = MoneyMatch(value_inr_cr=value_cr, raw_text=m.group(0), span=(start + m.start(), start + m.end()))
            best_distance = distance
    return best


# ------------------------------------------------------------------ #
# Keyword sets per target field
# ------------------------------------------------------------------ #
REVENUE_KEYWORDS = [
    "total revenue", "total income", "gross revenue", "net revenue",
    "revenue from operations", "operating income", "total business",
]
IT_SPEND_KEYWORDS = [
    "it spend", "it expenditure", "technology spend", "technology investment",
    "it infrastructure investment", "software investment", "it budget",
    "information technology expenditure", "it modernization",
]
DATA_CENTRE_KEYWORDS = [
    "data centre spend", "data center spend", "data centre investment",
    "data center investment", "dc infrastructure investment",
]
CYBERSECURITY_KEYWORDS = [
    "cybersecurity investment", "cyber security investment", "cybersecurity spend",
    "cyber security spend", "information security spend", "information security investment",
    "cybersecurity budget",
]
CLOUD_KEYWORDS = [
    "cloud spend", "cloud investment", "cloud infrastructure spend",
    "cloud migration spend", "cloud adoption investment",
]
DIGITAL_CAPEX_KEYWORDS = [
    "digital capex", "technology capex", "it capex",
    "digital transformation spend", "digital transformation investment",
    "digital modernization spend", "digital modernisation spend",
]

GLOBAL_SCOPE_MARKERS = ["global", "worldwide", "consolidated worldwide", "group-wide international"]
INDIA_SCOPE_MARKERS = ["india", "domestic", "pan-india", "pan india"]

FY_RE = re.compile(
    r"\bF\.?Y\.?\s?(20\d{2})\s?-\s?(\d{2,4})\b|\bFinancial Year\s+(20\d{2})\s?-\s?(\d{2,4})\b",
    re.IGNORECASE,
)
REPORT_TITLE_RE = re.compile(
    r"(annual report[^\n.]{0,60}|agm report[^\n.]{0,60}|annual general meeting[^\n.]{0,80})",
    re.IGNORECASE,
)

VENDOR_KEYWORDS = [
    "AWS", "Amazon Web Services", "Microsoft Azure", "Azure", "Google Cloud", "GCP",
    "Netmagic", "CtrlS", "Sify", "STT GDC", "Yotta", "NTT", "Web Werks",
    "Oracle Cloud", "IBM Cloud", "TCS", "Wipro", "Infosys", "HCL", "Tech Mahindra",
    "Digital Realty", "Equinix", "Rackspace", "Zoho",
]

BRANCH_RE = re.compile(r"(\d{1,5})\s*(?:branches|branch network)", re.IGNORECASE)
EMPLOYEE_RE = re.compile(r"(\d{1,6})\s*(?:employees|staff members|workforce)", re.IGNORECASE)


def _nearest_marker_scope(text: str, center: int, state_lower: str, window: int = 200) -> str:
    """Finds whichever scope marker (global / state / india) sits CLOSEST
    to `center` (a money value's position), not just "anywhere within a
    fixed window" -- a report that says "Total Revenue (India): Rs. X
    crore, Global revenue: Rs. Y crore" packs both scope words into one
    short paragraph, so proximity (not mere presence) is what actually
    disambiguates which number the marker describes."""
    start = max(0, center - window)
    end = min(len(text), center + window)
    segment = text[start:end].lower()

    best_scope = "unknown"
    best_distance = None

    def _consider(markers: list[str], scope: str) -> None:
        nonlocal best_scope, best_distance
        for marker in markers:
            if not marker:
                continue
            idx = segment.find(marker)
            while idx != -1:
                marker_center = start + idx + len(marker) // 2
                distance = abs(marker_center - center)
                if best_distance is None or distance < best_distance:
                    best_distance = distance
                    best_scope = scope
                idx = segment.find(marker, idx + 1)

    _consider(GLOBAL_SCOPE_MARKERS, "global")
    if state_lower:
        _consider([state_lower], "state")
    _consider(INDIA_SCOPE_MARKERS, "india")
    return best_scope


def find_scoped_money(text: str, keywords: list[str], state: str) -> Optional[tuple[MoneyMatch, str]]:
    """For revenue specifically: find a money value near one of the
    keywords that is explicitly scoped to India or the given state, and
    NOT explicitly scoped to "global"/"worldwide". Returns (match, scope)
    or None if nothing India/state-scoped was found -- callers must then
    write "N/A" rather than falling back to an unscoped or global figure.
    """
    lower_text = text.lower()
    state_lower = (state or "").lower()
    candidates: list[tuple[MoneyMatch, str, int]] = []  # (match, scope, distance_to_kw)

    for kw in keywords:
        for kw_match in re.finditer(re.escape(kw), lower_text):
            # Anchor the search at the END of the keyword phrase, not its
            # start -- money almost always follows the descriptive phrase
            # ("IT expenditure of Rs. X crore"), and a long keyword phrase
            # anchored at its start can end up numerically closer to an
            # unrelated figure in the *previous* sentence than to its own.
            money = find_money_near(text, kw_match.end())
            if money is None:
                continue
            # Scope is resolved by whichever marker (global/state/india)
            # sits *closest* to the matched number itself, not the
            # keyword -- so two revenue figures with different scopes
            # sitting in the same paragraph each get attributed correctly.
            money_center = (money.span[0] + money.span[1]) // 2
            scope = _nearest_marker_scope(text, money_center, state_lower)
            if scope in ("unknown", "global"):
                continue  # never guess, and never accept an explicitly-global figure
            candidates.append((money, scope, kw_match.start()))

    if not candidates:
        return None
    # Prefer state-scoped over india-scoped (more specific), then closest match.
    candidates.sort(key=lambda c: (0 if c[1] == "state" else 1))
    best = candidates[0]
    return best[0], best[1]


def find_spend_field(text: str, keywords: list[str]) -> Optional[MoneyMatch]:
    lower_text = text.lower()
    for kw in keywords:
        idx = lower_text.find(kw)
        if idx == -1:
            continue
        # Anchor at the END of the keyword phrase -- see the identical
        # comment in find_scoped_money for why.
        money = find_money_near(text, idx + len(kw))
        if money is not None:
            return money
    return None


def find_financial_year(text: str) -> str:
    m = FY_RE.search(text)
    if not m:
        return NA
    groups = [g for g in m.groups() if g]
    if len(groups) >= 2:
        return f"FY{groups[0]}-{groups[1]}"
    return NA


def find_report_name(text: str) -> str:
    m = REPORT_TITLE_RE.search(text)
    if not m:
        return NA
    return re.sub(r"\s+", " ", m.group(0)).strip().title()


def find_branch_count(text: str) -> str:
    m = BRANCH_RE.search(text)
    return m.group(1) if m else NA


def find_employee_count(text: str) -> str:
    m = EMPLOYEE_RE.search(text)
    return m.group(1) if m else NA


def find_mentioned_vendors(text: str) -> list[str]:
    found = []
    for vendor in VENDOR_KEYWORDS:
        if re.search(rf"\b{re.escape(vendor)}\b", text, re.IGNORECASE):
            found.append(vendor)
    return sorted(set(found))


INDIAN_STATES = [
    "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat",
    "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh",
    "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab",
    "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh",
    "Uttarakhand", "West Bengal", "Delhi", "Jammu & Kashmir", "Chandigarh", "Puducherry",
]
_STATE_RE = re.compile("|".join(re.escape(s) for s in sorted(INDIAN_STATES, key=len, reverse=True)), re.IGNORECASE)


def detect_state_mention(text: str) -> str:
    """Independent, evidence-only signal of which Indian state the
    citation text is actually about -- used by db_writer to cross-check
    against the seed's state (catches "grabbed the wrong same-named
    entity in a different state")."""
    if not text:
        return NA
    m = _STATE_RE.search(text)
    return m.group(0).title() if m else NA


def page_number_for_offset(pages: list[str], offset: int) -> str:
    """Maps a character offset into `" ".join(pages)` back to a
    1-indexed page number. `offset` must be relative to text built by
    joining `pages` with single spaces (exactly how translator builds
    TranslatedDocument.text from TranslatedDocument.pages) -- otherwise
    the boundary math here won't line up with the real page breaks."""
    if not pages:
        return NA
    running = 0
    for i, page_text in enumerate(pages):
        page_len = len(page_text) + 1  # +1 for the join separator
        if running <= offset < running + page_len:
            return str(i + 1)
        running += page_len
    return NA
