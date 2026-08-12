"""Scanned-vs-native PDF detection. Optional (`pdf` extra, pypdf) -- without it, we can't tell,
so we conservatively assume "not scanned" (native) and let extract_pdf_text's own None-if-empty
result be the fallback signal instead (a wrong "not scanned" guess just means OCR is skipped and
native extraction returns nothing, which is still handled -- see engine.py).
"""

from __future__ import annotations

_MIN_CHARS_PER_PAGE_TO_BE_NATIVE = 40


def is_scanned_pdf(content: bytes) -> bool | None:
    """True = scanned (needs OCR), False = native text present, None = couldn't determine
    (pypdf missing or read failure) -- never a crash."""
    try:
        from io import BytesIO

        from pypdf import PdfReader
    except ImportError:
        return None

    try:
        reader = PdfReader(BytesIO(content))
        if len(reader.pages) == 0:
            return None
        total_chars = sum(len(page.extract_text() or "") for page in reader.pages)
        avg_chars_per_page = total_chars / len(reader.pages)
    except Exception:  # noqa: BLE001
        return None

    return avg_chars_per_page < _MIN_CHARS_PER_PAGE_TO_BE_NATIVE
