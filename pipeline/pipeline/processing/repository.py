from __future__ import annotations

from typing import Any
from uuid import UUID

from psycopg import Connection
from psycopg.rows import dict_row

from pipeline.db.observability import log_processing
from pipeline.enums import DocumentStatus, LogLevel


def load_documents_to_process(conn: Connection, organization_id: UUID) -> list[dict[str, Any]]:
    """PROCESSED documents are already chunked from a prior run -- re-running processing on
    them would violate the (document_id, chunk_index) uniqueness idempotently only if we
    replace their chunks, which is wasted work when the content hasn't changed. Only documents
    not yet PROCESSED are picked up."""
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT document_id, organization_id, url, storage_path, file_format, status "
            "FROM documents WHERE organization_id = %s AND status <> %s",
            (str(organization_id), str(DocumentStatus.PROCESSED)),
        )
        return list(cur.fetchall())


def update_scan_and_language(
    conn: Connection, document_id: UUID, *, is_scanned: bool | None, detected_language: str | None
) -> None:
    conn.execute(
        "UPDATE documents SET is_scanned = COALESCE(%s, is_scanned), "
        "detected_language = COALESCE(%s, detected_language) WHERE document_id = %s",
        (is_scanned, detected_language, str(document_id)),
    )


def update_status(conn: Connection, document_id: UUID, status: DocumentStatus) -> None:
    conn.execute(
        "UPDATE documents SET status = %s WHERE document_id = %s",
        (str(status), str(document_id)),
    )


def save_translation(
    conn: Connection, document_id: UUID, *, source_language: str, translated_text: str, engine: str
) -> None:
    conn.execute(
        "INSERT INTO translations (document_id, source_language, target_language, translated_text, engine) "
        "VALUES (%s, %s, 'en', %s, %s)",
        (str(document_id), source_language, translated_text, engine),
    )


def replace_chunks(conn: Connection, document_id: UUID, chunks: list[tuple[int, str, int]]) -> None:
    """Idempotent re-chunking: delete-then-insert under one transaction rather than relying on
    ON CONFLICT DO NOTHING, so a re-run with different chunk boundaries (e.g. a config change)
    fully replaces the old set instead of leaving stale chunks mixed in."""
    conn.execute("DELETE FROM document_chunks WHERE document_id = %s", (str(document_id),))
    for chunk_index, text, token_count in chunks:
        conn.execute(
            "INSERT INTO document_chunks (document_id, chunk_index, chunk_text, token_count) "
            "VALUES (%s, %s, %s, %s)",
            (str(document_id), chunk_index, text, token_count),
        )


def log_quality_failure(conn: Connection, organization_id: UUID, document_id: UUID, reason: str) -> None:
    log_processing(
        conn,
        organization_id=organization_id,
        stage="PROCESSING",
        message=f"Document {document_id} failed quality validation, routed to manual review: {reason}",
        level=LogLevel.WARN,
    )
