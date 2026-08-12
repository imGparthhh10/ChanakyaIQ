from __future__ import annotations

from pipeline.config import Settings
from pipeline.processing.chunking import chunk_text
from pipeline.processing.cleaning import clean_text
from pipeline.processing.engine import process_document
from pipeline.processing.text_extract import extract_html_text
from uuid import uuid4


def test_extract_html_text_strips_tags_and_scripts() -> None:
    html = b"<html><head><script>evil()</script></head><body><p>Hello world.</p></body></html>"
    text = extract_html_text(html)
    assert "Hello world." in text
    assert "evil()" not in text


def test_clean_text_repairs_hyphenation() -> None:
    assert clean_text("infor-\nmation") == "information"


def test_clean_text_removes_repeated_boilerplate() -> None:
    lines = ["Page Footer"] * 5 + ["Real content line " + str(i) for i in range(20)] + ["Page Footer"] * 5
    cleaned = clean_text("\n".join(lines))
    assert "Page Footer" not in cleaned
    assert "Real content line 0" in cleaned


def test_chunk_text_respects_target_and_overlap() -> None:
    text = " ".join(f"word{i}" for i in range(1000))
    chunks = chunk_text(text, target_tokens=100, overlap_tokens=10)
    assert len(chunks) > 1
    assert all(c.token_count <= 100 for c in chunks)
    # consecutive chunks overlap
    assert chunks[0].text.split()[-1] in chunks[1].text.split()[: 15]


def test_chunk_text_empty_input() -> None:
    assert chunk_text("", target_tokens=100, overlap_tokens=10) == []


def test_process_document_html_passes_quality_gate() -> None:
    settings = Settings(DATABASE_URL="postgresql://unused/unused", PIPELINE_MIN_EXTRACTABLE_CHARS=10)
    html = b"<html><body>" + b"This is a real sentence with real content. " * 5 + b"</body></html>"
    result = process_document(uuid4(), html, "html", settings)
    assert result.passed_quality_check
    assert result.chunks
    assert result.detected_language in (None, "en")  # langdetect optional


def test_process_document_too_short_routes_to_review() -> None:
    settings = Settings(DATABASE_URL="postgresql://unused/unused", PIPELINE_MIN_EXTRACTABLE_CHARS=10000)
    html = b"<html><body>short</body></html>"
    result = process_document(uuid4(), html, "html", settings)
    assert not result.passed_quality_check
    assert result.reason is not None


def test_process_document_unsupported_format_no_crash() -> None:
    settings = Settings(DATABASE_URL="postgresql://unused/unused")
    result = process_document(uuid4(), b"binary garbage", "bin", settings)
    assert not result.passed_quality_check
    assert result.extracted is False
