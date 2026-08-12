"""Stage 4 entry point: scan detection -> OCR or native extraction -> language detection ->
translation (if regional Indian language) -> cleaning -> quality gate -> chunking.

`process_document` is pure (bytes in, ProcessingResult out) and does no DB I/O -- fully
testable without a database. `process_for_organization` is the thin wrapper that reads
documents, calls it once each, and persists the result -- no logic is duplicated between them.
"""

from __future__ import annotations

from pathlib import Path
from uuid import UUID

from pipeline.config import Settings
from pipeline.db.connection import get_connection
from pipeline.db.observability import log_processing
from pipeline.enums import DocumentStatus, LogLevel
from pipeline.processing.chunking import chunk_text
from pipeline.processing.cleaning import clean_text
from pipeline.processing.language import INDIAN_LANGUAGE_CODES, detect_language
from pipeline.processing.ocr import ocr_pdf
from pipeline.processing.pdf_scan_detect import is_scanned_pdf
from pipeline.processing.repository import (
    load_documents_to_process,
    log_quality_failure,
    replace_chunks,
    save_translation,
    update_scan_and_language,
    update_status,
)
from pipeline.processing.schema import ProcessingResult
from pipeline.processing.text_extract import extract_pdf_text, extract_text


def _extract_raw_text(content: bytes, file_format: str, *, is_scanned: bool | None) -> str | None:
    if file_format.lower() == "pdf":
        if is_scanned:
            return ocr_pdf(content)
        native = extract_pdf_text(content)
        # Scan-detection was inconclusive (None) or wrongly said "native" -- native extraction
        # returning nothing is the fallback signal to try OCR anyway.
        return native if native else ocr_pdf(content)
    return extract_text(content, file_format)


def process_document(
    document_id: UUID, content: bytes, file_format: str, settings: Settings
) -> ProcessingResult:
    is_scanned = is_scanned_pdf(content) if file_format.lower() == "pdf" else False
    raw_text = _extract_raw_text(content, file_format, is_scanned=is_scanned)

    if raw_text is None:
        return ProcessingResult(
            document_id=document_id, is_scanned=is_scanned, extracted=False, detected_language=None,
            translated=False, passed_quality_check=False,
            reason="No extractable text (OCR/native extraction unavailable or produced nothing).",
        )

    detected_language = detect_language(raw_text)
    translated = False
    translated_text: str | None = None
    text_for_cleaning = raw_text
    if detected_language and detected_language in INDIAN_LANGUAGE_CODES:
        from pipeline.processing.translation import translate_to_english

        translated_text = translate_to_english(raw_text, detected_language)
        if translated_text:
            text_for_cleaning = translated_text
            translated = True
        # else: IndicTrans2 unavailable -- fall through untranslated.

    cleaned = clean_text(text_for_cleaning)
    if len(cleaned) < settings.min_extractable_chars:
        return ProcessingResult(
            document_id=document_id, is_scanned=is_scanned, extracted=True, detected_language=detected_language,
            translated=translated, translated_text=translated_text, passed_quality_check=False,
            reason=f"Only {len(cleaned)} usable characters after cleaning "
            f"(minimum {settings.min_extractable_chars}).",
        )

    chunks = chunk_text(
        cleaned, target_tokens=settings.chunk_target_tokens, overlap_tokens=settings.chunk_overlap_tokens
    )
    return ProcessingResult(
        document_id=document_id, is_scanned=is_scanned, extracted=True, detected_language=detected_language,
        translated=translated, translated_text=translated_text, chunks=chunks, passed_quality_check=True,
    )


def _persist(conn, organization_id: UUID, result: ProcessingResult) -> None:  # type: ignore[no-untyped-def]
    update_scan_and_language(
        conn, result.document_id, is_scanned=result.is_scanned, detected_language=result.detected_language
    )
    if result.is_scanned:
        update_status(conn, result.document_id, DocumentStatus.OCR_DONE if result.extracted else DocumentStatus.OCR_PENDING)

    if result.translated and result.translated_text and result.detected_language:
        save_translation(
            conn, result.document_id, source_language=result.detected_language,
            translated_text=result.translated_text, engine="IndicTrans2",
        )
    elif result.detected_language in INDIAN_LANGUAGE_CODES and not result.translated:
        log_processing(
            conn, organization_id=organization_id, stage="PROCESSING",
            message=f"Document {result.document_id} is in '{result.detected_language}' but IndicTrans2 "
            "is not installed -- processing continued on untranslated text where possible.",
            level=LogLevel.WARN,
        )

    if not result.passed_quality_check:
        log_quality_failure(conn, organization_id, result.document_id, result.reason or "unknown")
        return

    replace_chunks(conn, result.document_id, [(c.chunk_index, c.text, c.token_count) for c in result.chunks])
    update_status(conn, result.document_id, DocumentStatus.PROCESSED)
    log_processing(
        conn, organization_id=organization_id, stage="PROCESSING",
        message=f"Document {result.document_id} processed: {len(result.chunks)} chunks, "
        f"language={result.detected_language or 'unknown'}, translated={result.translated}.",
        level=LogLevel.INFO,
    )


def process_for_organization(organization_id: UUID, settings: Settings) -> list[ProcessingResult]:
    with get_connection(settings) as conn:
        documents = load_documents_to_process(conn, organization_id)

    results: list[ProcessingResult] = []
    for doc in documents:
        path = Path(doc["storage_path"])
        content = path.read_bytes() if path.exists() else b""
        result = process_document(doc["document_id"], content, doc["file_format"] or "", settings)
        results.append(result)
        with get_connection(settings) as conn:
            _persist(conn, organization_id, result)
    return results
