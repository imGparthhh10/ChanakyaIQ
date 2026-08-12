from __future__ import annotations

from pipeline.classification.rules import best_classification, score_document_type
from pipeline.enums import DocumentType


def test_url_signal_drives_classification() -> None:
    scores = score_document_type(url="https://bank.co.in/investors/annual-report", content=b"", content_type=None)
    doc_type, confidence = best_classification(scores)
    assert doc_type == DocumentType.ANNUAL_REPORT
    assert confidence > 0


def test_text_signal_adds_to_url_signal() -> None:
    html = b"<html><title>Notice of Annual General Meeting</title><body>...</body></html>"
    scores = score_document_type(url="https://bank.co.in/agm", content=html, content_type="text/html")
    doc_type, confidence = best_classification(scores)
    assert doc_type == DocumentType.AGM_REPORT
    assert confidence > 0.5  # url + text signals compound


def test_no_signal_returns_none() -> None:
    scores = score_document_type(url="https://bank.co.in/random-page-xyz", content=b"", content_type=None)
    doc_type, confidence = best_classification(scores)
    assert doc_type is None
    assert confidence == 0.0


def test_social_media_url_classified_correctly() -> None:
    scores = score_document_type(url="https://linkedin.com/company/testbank", content=b"", content_type=None)
    doc_type, _ = best_classification(scores)
    assert doc_type == DocumentType.SOCIAL_MEDIA
