"""Native text extraction — HTML always works (stdlib only); PDF needs the optional `pdf`
extra (pypdf). Neither path ever raises for a missing dependency: PDF extraction returns None
and the caller logs a WARN + routes the document to manual review (rule 2).
"""

from __future__ import annotations

import re

_TAG_RE = re.compile(rb"<(script|style)[^>]*>.*?</\1>", re.IGNORECASE | re.DOTALL)
_ANY_TAG_RE = re.compile(rb"<[^>]+>")
_WHITESPACE_RE = re.compile(r"[ \t]+")


def extract_html_text(content: bytes) -> str:
    no_script_style = _TAG_RE.sub(b" ", content)
    text = _ANY_TAG_RE.sub(b" ", no_script_style).decode("utf-8", errors="ignore")
    # Collapse runs of spaces/tabs but keep newlines -- cleaning.py handles finer whitespace repair.
    lines = [_WHITESPACE_RE.sub(" ", line).strip() for line in text.splitlines()]
    return "\n".join(line for line in lines if line)


def extract_pdf_text(content: bytes) -> str | None:
    """Returns None if pypdf isn't installed, or if extraction yields nothing (likely scanned --
    is_scanned() in pdf_scan_detect.py is the authoritative check, this is just a fallback)."""
    try:
        from io import BytesIO

        from pypdf import PdfReader
    except ImportError:
        return None

    try:
        reader = PdfReader(BytesIO(content))
        pages_text = [page.extract_text() or "" for page in reader.pages]
    except Exception:  # noqa: BLE001 -- a corrupt/unusual PDF must degrade, not crash the run
        return None

    text = "\n".join(pages_text).strip()
    return text or None


def extract_text(content: bytes, file_format: str) -> str | None:
    fmt = file_format.lower()
    if fmt in ("html", "htm"):
        return extract_html_text(content)
    if fmt == "pdf":
        return extract_pdf_text(content)
    if fmt == "txt":
        return content.decode("utf-8", errors="ignore")
    return None
