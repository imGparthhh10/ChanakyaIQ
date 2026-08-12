"""Language detection + ISO-639-1 -> IndicTrans2 (FLORES-200) code mapping."""
from __future__ import annotations

from langdetect import DetectorFactory, LangDetectException, detect

# Deterministic results across runs (langdetect is otherwise seeded randomly).
DetectorFactory.seed = 0

# The scheduled Indian languages IndicTrans2's indic-en model supports,
# mapped from langdetect's ISO-639-1 codes to FLORES-200 codes.
ISO_TO_FLORES = {
    "hi": "hin_Deva", "mr": "mar_Deva", "ta": "tam_Taml", "te": "tel_Telu",
    "bn": "ben_Beng", "gu": "guj_Gujr", "kn": "kan_Knda", "ml": "mal_Mlym",
    "pa": "pan_Guru", "or": "ori_Orya", "as": "asm_Beng", "ur": "urd_Arab",
    "ne": "npi_Deva", "sd": "snd_Arab", "sa": "san_Deva",
}


def detect_language(text: str) -> str:
    """Returns an ISO-639-1 code, defaulting to 'en' for empty/too-short/
    undetectable text (never raises)."""
    sample = (text or "").strip()
    if len(sample) < 20:
        return "en"
    try:
        return detect(sample)
    except LangDetectException:
        return "en"


def flores_code_for(iso2: str) -> str | None:
    return ISO_TO_FLORES.get(iso2)
