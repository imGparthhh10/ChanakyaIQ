from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from psycopg import Connection
from psycopg.rows import dict_row

from pipeline.enums import DocumentStatus, ExtractionStatus


def load_processed_documents_with_chunks(
    conn: Connection, organization_id: UUID, *, max_chunks_per_document: int, prompt_version: str
) -> list[dict[str, Any]]:
    """Excludes documents that already have a PASSED enrichment_job at the current
    prompt_version -- re-running the pipeline on unchanged data must not re-extract (and
    re-insert enrichment_jobs/llm_profiles/extracted_entities/timeline_events) for a document
    whose content and prompt version haven't changed since the last successful run."""
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT d.document_id FROM documents d WHERE d.organization_id = %s AND d.status = %s "
            "AND NOT EXISTS ("
            "  SELECT 1 FROM enrichment_jobs ej WHERE ej.document_id = d.document_id "
            "  AND ej.status = %s AND ej.prompt_version = %s"
            ")",
            (str(organization_id), str(DocumentStatus.PROCESSED), str(ExtractionStatus.PASSED), prompt_version),
        )
        documents = list(cur.fetchall())

        out = []
        for doc in documents:
            cur.execute(
                "SELECT chunk_index, chunk_text FROM document_chunks WHERE document_id = %s "
                "ORDER BY chunk_index LIMIT %s",
                (str(doc["document_id"]), max_chunks_per_document),
            )
            chunks = list(cur.fetchall())
            if chunks:
                out.append({"document_id": doc["document_id"], "chunks": chunks})
        return out


def create_enrichment_job(conn: Connection, organization_id: UUID, document_id: UUID) -> UUID:
    row = conn.execute(
        "INSERT INTO enrichment_jobs (organization_id, document_id, status, started_at) "
        "VALUES (%s, %s, %s, %s) RETURNING enrichment_job_id",
        (str(organization_id), str(document_id), str(ExtractionStatus.RUNNING), datetime.now(UTC)),
    ).fetchone()
    assert row is not None
    return UUID(str(row[0]))


def finish_enrichment_job(
    conn: Connection,
    enrichment_job_id: UUID,
    *,
    status: ExtractionStatus,
    llm_model: str | None = None,
    prompt_version: str | None = None,
    raw_response: dict[str, Any] | None = None,
    confidence_score: float | None = None,
    error_message: str | None = None,
) -> None:
    conn.execute(
        "UPDATE enrichment_jobs SET status = %s, llm_model = %s, prompt_version = %s, "
        "raw_response_json = %s, confidence_score = %s, error_message = %s, finished_at = %s "
        "WHERE enrichment_job_id = %s",
        (
            str(status), llm_model, prompt_version,
            json.dumps(raw_response) if raw_response is not None else None,
            confidence_score, error_message, datetime.now(UTC), str(enrichment_job_id),
        ),
    )


def save_llm_profile(
    conn: Connection, enrichment_job_id: UUID, organization_id: UUID, profile_json: dict[str, Any]
) -> UUID:
    row = conn.execute(
        "INSERT INTO llm_profiles (enrichment_job_id, organization_id, profile_json) "
        "VALUES (%s, %s, %s) RETURNING llm_profile_id",
        (str(enrichment_job_id), str(organization_id), json.dumps(profile_json)),
    ).fetchone()
    assert row is not None
    return UUID(str(row[0]))
