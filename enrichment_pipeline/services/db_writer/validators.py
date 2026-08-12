"""Pre-write validation for db_writer. Every one of these must pass
before a record is ever inserted -- each failure is logged with its
specific reason so the audit trail explains exactly why a qualified
record still didn't make it into the database.
"""
from __future__ import annotations

import re
from typing import Any

STATE_ALIASES = {
    "tamilnadu": "tamil nadu", "orissa": "odisha", "pondicherry": "puducherry",
    "jammu and kashmir": "jammu & kashmir",
}
GENERIC_NAME_WORDS = {
    "bank", "ltd", "limited", "co", "co-operative", "cooperative", "coop",
    "urban", "the", "pvt", "private", "company", "society", "niyamit",
    "niyamitha", "maryadit", "sahakari", "sahakara", "nagarik", "nagrik",
}


def _norm_state(s: str | None) -> str:
    s = (s or "").strip().lower()
    return STATE_ALIASES.get(s, s)


def state_match(record_state: str | None, seed_state: str | None) -> tuple[bool, str]:
    rs, ss = _norm_state(record_state), _norm_state(seed_state)
    if not ss or ss == "n/a":
        return True, "no seed state to check against"
    if not rs or rs == "n/a":
        return True, "record has no state on file, nothing to contradict"
    if rs == ss:
        return True, "state matches"
    return False, f"state mismatch: record={record_state!r} seed={seed_state!r}"


def india_scope_ok(record: dict[str, Any]) -> tuple[bool, str]:
    revenue = str(record.get("revenue_inr_cr", "N/A")).upper()
    if revenue == "N/A":
        return True, "no revenue figure to check"
    scope = record.get("revenue_scope")
    if scope in ("india", "state"):
        return True, f"revenue explicitly scoped to {scope}"
    return False, f"revenue present but not explicitly India/state scoped (scope={scope!r})"


def _significant_tokens(name: str) -> list[str]:
    tokens = re.findall(r"[a-z]{4,}", (name or "").lower())
    return [t for t in tokens if t not in GENERIC_NAME_WORDS]


def entity_confirmed_in_evidence(entity_name: str, raw_snippet: str, report_name: str, source_url: str) -> tuple[bool, float, str]:
    """Fuzzy confirmation that the evidence we captured is actually about
    this entity: at least one of the entity's distinctive name tokens
    must appear somewhere in the captured snippet / report title / URL.
    Not a strict full-name match -- our evidence windows are narrow
    (~220 chars around a money figure), so demanding a full match would
    reject a lot of genuinely correct data; this still catches the real
    failure mode of "found a number on the wrong company's page"."""
    sig = _significant_tokens(entity_name)
    if not sig:
        return True, 1.0, "entity name has no distinctive tokens to check"
    haystack = f"{raw_snippet} {report_name} {source_url}".lower()
    matched = [t for t in sig if t in haystack]
    ratio = len(matched) / len(sig)
    if matched:
        return True, ratio, f"{len(matched)}/{len(sig)} distinctive name token(s) found in evidence"
    return False, 0.0, "none of the entity's distinctive name tokens appear in the captured evidence"


def duplicate_value_fingerprint(record: dict[str, Any]) -> str | None:
    """A fingerprint of the record's sourced values. If two *different*
    entities produce the same fingerprint in the same run, it's a strong
    signal the crawler/extractor pulled the same boilerplate page for
    both -- real data, wrong entity -- so it's rejected as a duplicate
    rather than silently written twice."""
    parts = [
        str(record.get("source_url", "N/A")),
        str(record.get("revenue_inr_cr", "N/A")),
        str(record.get("it_spend_inr_cr", "N/A")),
    ]
    if all(p == "N/A" for p in parts):
        return None  # nothing distinctive enough to fingerprint
    return "|".join(parts)
