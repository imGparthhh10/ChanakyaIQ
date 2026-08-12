"""Language detection. Optional (`lang` extra: langdetect). Missing -> detected_language stays
NULL, which is correct (rule 1: a missing field is correct; an invented one corrupts the
dashboard) -- never default to "en" as a guess.
"""

from __future__ import annotations

# ISO 639-1 codes considered "regional Indian language" for the translation stage's routing
# decision -- not exhaustive of every Indian language, but the set IndicTrans2 supports well
# and that this pipeline is likely to actually encounter in BFSI filings.
INDIAN_LANGUAGE_CODES = {
    "hi", "bn", "ta", "te", "mr", "gu", "kn", "ml", "pa", "or", "as", "ur",
}


def detect_language(text: str) -> str | None:
    if not text or not text.strip():
        return None
    try:
        from langdetect import detect
    except ImportError:
        return None

    try:
        result: str = detect(text)
        return result
    except Exception:  # noqa: BLE001 -- langdetect raises its own exception type on unparseable input
        return None
