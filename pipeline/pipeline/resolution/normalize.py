"""Pure normalization helpers -- no I/O, fully unit-testable."""

from __future__ import annotations

import re

_COMPANY_SUFFIXES = [
    "private limited", "pvt. ltd.", "pvt ltd", "limited", "ltd.", "ltd",
    "llp", "inc.", "inc", "corp.", "corp", "co.", "& co", "and co",
]
_WHITESPACE_RE = re.compile(r"\s+")

_CLOUD_PROVIDER_KEYWORDS = {
    "aws": "AWS", "amazon web services": "AWS",
    "azure": "Microsoft Azure", "microsoft azure": "Microsoft Azure",
    "gcp": "Google Cloud", "google cloud": "Google Cloud",
    "oracle cloud": "Oracle Cloud",
    "ibm cloud": "IBM Cloud",
}


def normalize_company_name(name: str) -> str:
    normalized = _WHITESPACE_RE.sub(" ", name).strip().lower()
    changed = True
    while changed:
        changed = False
        for suffix in _COMPANY_SUFFIXES:
            if normalized.endswith(suffix):
                normalized = normalized[: -len(suffix)].strip().rstrip(",.").strip()
                changed = True
    return normalized


def normalize_person_name(name: str) -> str:
    return _WHITESPACE_RE.sub(" ", name).strip()


def normalize_generic(value: str) -> str:
    return _WHITESPACE_RE.sub(" ", value).strip().lower()


def detect_cloud_providers(text: str) -> list[str]:
    """Deterministic keyword matching, not NLP -- re-tags text already present in the extracted
    value, never invents a provider that wasn't mentioned."""
    haystack = text.lower()
    found: list[str] = []
    for keyword, canonical in _CLOUD_PROVIDER_KEYWORDS.items():
        if keyword in haystack and canonical not in found:
            found.append(canonical)
    return found
