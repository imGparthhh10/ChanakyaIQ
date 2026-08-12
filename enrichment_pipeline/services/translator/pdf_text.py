"""Per-page PDF text extraction for the translator.

This is the single source of truth for PDF page boundaries in the
pipeline: the translator extracts page-by-page text here, translates (or
passes through) each page independently, and hands the resulting
`pages: list[str]` on to the extractor -- so a field the extractor finds
on page 7 of the translated text really did come from page 7 of the
original PDF, even after translation.
"""
from __future__ import annotations

import logging
import re

log = logging.getLogger("translator.pdf_text")

MAX_PAGES = 60  # bound worst-case runtime on a single very large report
_WS_RE = re.compile(r"\s+")


def _normalize_whitespace(text: str) -> str:
    """Collapse internal newlines/runs of whitespace to single spaces.

    pdfplumber's extract_text() preserves the PDF's own line breaks --
    which means a phrase like "Cybersecurity investment" can come back as
    "Cybersecurity\\ninvestment" purely because of where the PDF happened
    to wrap the line. Every downstream keyword/regex match in the
    extractor is written assuming single-space-separated phrases, so
    normalizing here (once, at the source) is what makes those matches
    actually fire on real PDF text instead of silently missing on
    arbitrary line-wrap positions.
    """
    return _WS_RE.sub(" ", text or "").strip()


def extract_pdf_pages(path: str) -> list[str]:
    try:
        import pdfplumber
    except ImportError:
        log.error("pdfplumber not installed -- cannot extract PDF text")
        return []

    pages: list[str] = []
    try:
        with pdfplumber.open(path) as pdf:
            for i, page in enumerate(pdf.pages):
                if i >= MAX_PAGES:
                    log.warning("PDF %s has more than %d pages, truncating", path, MAX_PAGES)
                    break
                try:
                    text = page.extract_text() or ""
                except Exception as exc:  # noqa: BLE001 - one bad page must not lose the rest
                    log.warning("failed to extract text from page %d of %s: %s", i + 1, path, exc)
                    text = ""
                pages.append(_normalize_whitespace(text))
    except Exception as exc:  # noqa: BLE001 - a corrupt/unreadable PDF must not crash the caller
        log.warning("failed to open PDF %s: %s", path, exc)
        return []
    return pages
