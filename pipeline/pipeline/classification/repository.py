from __future__ import annotations

from typing import Any
from uuid import UUID

from psycopg import Connection
from psycopg.rows import dict_row

from pipeline.db.observability import log_processing
from pipeline.enums import LogLevel


def load_documents_for_org(conn: Connection, organization_id: UUID) -> list[dict[str, Any]]:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT document_id, organization_id, document_type, url, storage_path, file_format "
            "FROM documents WHERE organization_id = %s",
            (str(organization_id),),
        )
        return list(cur.fetchall())


def apply_document_type(conn: Connection, document_id: UUID, document_type: str) -> None:
    conn.execute(
        "UPDATE documents SET document_type = %s::document_type WHERE document_id = %s",
        (document_type, str(document_id)),
    )


def log_low_confidence(conn: Connection, organization_id: UUID, document_id: UUID, url: str, confidence: float) -> None:
    log_processing(
        conn,
        organization_id=organization_id,
        stage="CLASSIFICATION",
        message=(
            f"Low-confidence classification ({confidence:.2f}) for document {document_id} "
            f"({url}); keeping discovery-assigned type rather than guessing wrong."
        ),
        level=LogLevel.WARN,
    )
