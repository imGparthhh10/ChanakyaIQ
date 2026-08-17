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
# Same global-vs-India/state scoping ambiguity as revenue applies here too
# (a listed MNC's annual report routinely states both a global PAT and an
# India-subsidiary PAT in the same paragraph) -- reuses find_scoped_money,
# not find_spend_field, for exactly that reason.
NET_PROFIT_KEYWORDS = [
    "net profit", "profit after tax", "profit for the year", "net income",
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

# ------------------------------------------------------------------ #
# Head office address
# ------------------------------------------------------------------ #
HEAD_OFFICE_KEYWORDS = [
    "registered office", "registered address", "corporate office",
    "head office", "headquartered at", "principal place of business",
]
_ADDRESS_LEADING_PUNCT_RE = re.compile(r"^[\s:,\-–—]+")
_ADDRESS_STOP_RE = re.compile(r"[.\n]")


def find_head_office_address(text: str) -> Optional[MoneyMatch]:
    """Captures the text immediately following a head-office keyword, up to
    the next sentence break -- reuses MoneyMatch as a generic
    (value, raw_text, span) carrier even though there's no money involved,
    so callers/citations work identically to every other extracted field.
    Length-bounded (10-250 chars) as a sanity filter: too short is
    probably a stray keyword mention with no address after it ("our
    registered office is undergoing renovation"), too long means the stop
    regex ran off into unrelated following text rather than an address."""
    lower = text.lower()
    for kw in HEAD_OFFICE_KEYWORDS:
        idx = lower.find(kw)
        if idx == -1:
            continue
        start = idx + len(kw)
        skip = _ADDRESS_LEADING_PUNCT_RE.match(text[start:start + 10])
        if skip:
            start += skip.end()
        stop = _ADDRESS_STOP_RE.search(text, start)
        end = stop.start() if stop else min(len(text), start + 220)
        snippet = text[start:end].strip()
        if 10 <= len(snippet) <= 250:
            return MoneyMatch(value_inr_cr=0.0, raw_text=snippet, span=(start, end))
    return None


# ------------------------------------------------------------------ #
# Leadership (name-near-role-title extraction)
# ------------------------------------------------------------------ #
# Rule-based name extraction is inherently less reliable than the money
# regexes above -- there's no NER model in this pipeline by design (see
# the module docstring: every value must trace to literal source text, no
# LLM). This stays deliberately conservative: a tight window around the
# role keyword, a name-shaped token pattern, and a blocklist of common
# capitalized non-name phrases that turn up near these keywords in real
# annual reports (section headings, boilerplate). Callers get the raw
# snippet too, so a wrong extraction is always human-checkable, same
# guarantee every other field in this module makes.
CEO_KEYWORDS = ["chief executive officer", "managing director & ceo", "managing director and ceo", "ceo"]
CTO_KEYWORDS = ["chief technology officer", "cto"]
CIO_KEYWORDS = ["chief information officer", "cio"]
CHAIRMAN_KEYWORDS = ["chairman", "chairperson"]

_TITLE_PREFIX = r"(?:Mr\.?|Ms\.?|Mrs\.?|Dr\.?|Shri|Smt\.?)\s+"
_NAME_TOKEN = r"[A-Z][a-zA-Z'.-]{1,20}"
# 2-4 capitalized tokens, optionally preceded by a courtesy title -- the
# title makes a match far more trustworthy, so find_person_near_role()
# tries a title-anchored pattern first and only falls back to a bare
# capitalized-sequence pattern (higher false-positive risk) if that fails.
_NAME_WITH_TITLE_RE = re.compile(rf"{_TITLE_PREFIX}({_NAME_TOKEN}(?:\s+{_NAME_TOKEN}){{1,3}})")
_NAME_BARE_RE = re.compile(rf"({_NAME_TOKEN}(?:\s+{_NAME_TOKEN}){{1,3}})")

_NAME_BLOCKLIST_WORDS = {
    "annual", "report", "board", "directors", "company", "companies", "limited",
    "private", "corporate", "office", "officer", "committee", "meeting", "general",
    "financial", "statement", "statements", "management", "discussion", "analysis",
    "notice", "notes", "accounts", "india", "indian", "group", "holdings", "bank",
    "chief", "executive", "technology", "information", "chairman", "chairperson",
    "managing", "director", "governance", "corporate", "sustainability", "review",
}


def _looks_like_a_name(candidate: str) -> bool:
    words = candidate.split()
    if not (2 <= len(words) <= 4):
        return False
    lowered = {w.lower().strip(".,") for w in words}
    if lowered & _NAME_BLOCKLIST_WORDS:
        return False
    return all(w[0].isupper() for w in words)


def find_person_near_role(text: str, role_keywords: list[str], window: int = 100) -> Optional[MoneyMatch]:
    """Looks both before and after each role-keyword occurrence (name
    precedes the title in "John Doe, Chief Executive Officer, said..." but
    follows it in "Chief Executive Officer Mr. John Doe"), preferring a
    courtesy-title-anchored match over a bare capitalized-sequence match
    at the same distance since the title is a much stronger name signal."""
    lower_text = text.lower()
    best: Optional[MoneyMatch] = None
    best_score = None  # (has_title=0 sorts before 1, then distance)

    for kw in role_keywords:
        # \b word boundaries -- matters most for the short abbreviations
        # ("ceo"/"cto"/"cio"), which would otherwise match as a bare
        # substring inside an unrelated longer word.
        for kw_match in re.finditer(rf"\b{re.escape(kw)}\b", lower_text):
            k_start, k_end = kw_match.start(), kw_match.end()
            seg_start = max(0, k_start - window)
            seg_end = min(len(text), k_end + window)
            segment = text[seg_start:seg_end]

            candidates: list[tuple[str, int, int, bool]] = []  # (name, start, end, has_title)
            for m in _NAME_WITH_TITLE_RE.finditer(segment):
                candidates.append((m.group(1), seg_start + m.start(1), seg_start + m.end(1), True))
            for m in _NAME_BARE_RE.finditer(segment):
                candidates.append((m.group(1), seg_start + m.start(1), seg_start + m.end(1), False))

            for name, n_start, n_end, has_title in candidates:
                if not _looks_like_a_name(name):
                    continue
                distance = min(abs(n_start - k_end), abs(k_start - n_end))
                score = (0 if has_title else 1, distance)
                if best_score is None or score < best_score:
                    best_score = score
                    best = MoneyMatch(value_inr_cr=0.0, raw_text=name.strip(), span=(n_start, n_end))
    return best


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
