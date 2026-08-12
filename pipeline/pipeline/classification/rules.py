"""Pure, network-free, dependency-free classification signal scoring. Deliberately doesn't
depend on the optional PDF/OCR stack (stage 4 territory) -- classification runs on whatever's
cheaply available right after download: the URL, an HTML <title> if present, and a short text
sample pulled from raw bytes with a regex tag-strip (not a real HTML parser -- good enough for
signal words, not meant to produce clean text; that's stage 4's job).
"""

from __future__ import annotations

import re

from pipeline.enums import DocumentType

_TAG_RE = re.compile(rb"<[^>]+>")
_TITLE_RE = re.compile(rb"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)

# (url substring, doc type, weight) -- first match per type wins, weights are additive across
# independent signal sources (url + title + text) so agreement across sources compounds.
_URL_SIGNALS: list[tuple[str, DocumentType, float]] = [
    ("/investor", DocumentType.INVESTOR_PAGE, 0.45),
    ("/ir/", DocumentType.INVESTOR_PAGE, 0.35),
    ("annual-report", DocumentType.ANNUAL_REPORT, 0.5),
    ("annual_report", DocumentType.ANNUAL_REPORT, 0.5),
    ("/agm", DocumentType.AGM_REPORT, 0.5),
    ("financial-result", DocumentType.FINANCIAL_STATEMENT, 0.45),
    ("financial-statement", DocumentType.FINANCIAL_STATEMENT, 0.45),
    ("sustainability", DocumentType.SUSTAINABILITY_CSR, 0.45),
    ("/csr", DocumentType.SUSTAINABILITY_CSR, 0.4),
    ("/press", DocumentType.PRESS_RELEASE, 0.4),
    ("/media", DocumentType.PRESS_RELEASE, 0.3),
    ("/news", DocumentType.NEWS, 0.35),
    ("news.google.com", DocumentType.NEWS, 0.5),
    ("/career", DocumentType.CAREER, 0.5),
    ("/job", DocumentType.CAREER, 0.3),
    ("rbi.org.in", DocumentType.RBI_PUBLICATION, 0.5),
    ("sebi.gov.in", DocumentType.GOVERNMENT_WEBSITE, 0.5),
    ("mca.gov.in", DocumentType.GOVERNMENT_WEBSITE, 0.5),
    (".gov.in", DocumentType.GOVERNMENT_WEBSITE, 0.3),
    ("twitter.com", DocumentType.SOCIAL_MEDIA, 0.5),
    ("x.com", DocumentType.SOCIAL_MEDIA, 0.4),
    ("linkedin.com", DocumentType.SOCIAL_MEDIA, 0.5),
    ("facebook.com", DocumentType.SOCIAL_MEDIA, 0.5),
]

_TEXT_SIGNALS: list[tuple[str, DocumentType, float]] = [
    ("annual report", DocumentType.ANNUAL_REPORT, 0.35),
    ("notice of annual general meeting", DocumentType.AGM_REPORT, 0.45),
    ("annual general meeting", DocumentType.AGM_REPORT, 0.3),
    ("balance sheet", DocumentType.FINANCIAL_STATEMENT, 0.3),
    ("profit and loss", DocumentType.FINANCIAL_STATEMENT, 0.25),
    ("corporate social responsibility", DocumentType.SUSTAINABILITY_CSR, 0.35),
    ("sustainability report", DocumentType.SUSTAINABILITY_CSR, 0.35),
    ("press release", DocumentType.PRESS_RELEASE, 0.3),
    ("we are hiring", DocumentType.CAREER, 0.3),
    ("open positions", DocumentType.CAREER, 0.3),
    ("current openings", DocumentType.CAREER, 0.3),
    ("investor relations", DocumentType.INVESTOR_PAGE, 0.3),
]


def _extract_title(html_bytes: bytes) -> str:
    m = _TITLE_RE.search(html_bytes)
    if not m:
        return ""
    return _TAG_RE.sub(b"", m.group(1)).decode("utf-8", errors="ignore").strip()


def _text_sample(content: bytes, *, max_chars: int = 4000) -> str:
    stripped = _TAG_RE.sub(b" ", content[: max_chars * 4])
    return stripped.decode("utf-8", errors="ignore")[:max_chars]


def score_document_type(*, url: str, content: bytes, content_type: str | None) -> dict[DocumentType, float]:
    scores: dict[DocumentType, float] = {}
    url_lower = url.lower()
    for needle, doc_type, weight in _URL_SIGNALS:
        if needle in url_lower:
            scores[doc_type] = scores.get(doc_type, 0.0) + weight

    is_html = (content_type or "").startswith("text/html") or b"<html" in content[:2000].lower()
    if is_html:
        title = _extract_title(content).lower()
        sample = _text_sample(content).lower()
        haystack = f"{title} {sample}"
        for needle, doc_type, weight in _TEXT_SIGNALS:
            if needle in haystack:
                scores[doc_type] = scores.get(doc_type, 0.0) + weight

    return scores


def best_classification(scores: dict[DocumentType, float]) -> tuple[DocumentType | None, float]:
    if not scores:
        return None, 0.0
    doc_type, score = max(scores.items(), key=lambda kv: kv[1])
    return doc_type, min(score, 1.0)
