"""Scanned-PDF OCR. Optional (`ocr` extra: pytesseract + pdf2image + Pillow), and pdf2image
itself shells out to the system `poppler` binary (not a pip package) -- documented in
pipeline/README.md's dependency table. Any missing piece degrades to None, never a crash.
"""

from __future__ import annotations


def ocr_pdf(content: bytes) -> str | None:
    try:
        import pytesseract
        from pdf2image import convert_from_bytes
    except ImportError:
        return None

    try:
        images = convert_from_bytes(content)
        pages_text = [pytesseract.image_to_string(img) for img in images]
    except Exception:  # noqa: BLE001 -- missing poppler/tesseract binaries raise here too
        return None

    text = "\n".join(pages_text).strip()
    return text or None
