"""All DML for the collection stage: crawl_jobs lifecycle, the documents/document_versions
upsert-on-change logic, and the failed-jobs query the orchestrator's replay command uses.

documents has a real unique constraint on (organization_id, checksum) — enforced by Postgres,
not just assumed here. (organization_id, url) has no DB constraint, so "is this a re-fetch of
a document we already have" is resolved here by explicit lookup before insert, not by relying
on a constraint that doesn't exist.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from psycopg import Connection
from psycopg.rows import dict_row

from pipeline.collection.schema import CollectionOutcome, CrawlSourceRow, FetchedDocument
from pipeline.collection.storage import save_content
from pipeline.config import Settings
from pipeline.db.observability import log_processing
from pipeline.enums import CrawlJobStatus, DocumentStatus, LogLevel


def load_active_sources(conn: Connection, organization_id: UUID) -> list[CrawlSourceRow]:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT crawl_source_id, organization_id, source_type, url "
            "FROM crawl_sources WHERE organization_id = %s AND is_active = TRUE "
            "ORDER BY discovered_at",
            (str(organization_id),),
        )
        return [CrawlSourceRow(**row) for row in cur.fetchall()]


def create_crawl_job(conn: Connection, organization_id: UUID, crawl_source_id: UUID) -> UUID:
    row = conn.execute(
        "INSERT INTO crawl_jobs (organization_id, crawl_source_id, status, started_at) "
        "VALUES (%s, %s, 'RUNNING', %s) RETURNING crawl_job_id",
        (str(organization_id), str(crawl_source_id), datetime.now(UTC)),
    ).fetchone()
    assert row is not None
    return UUID(str(row[0]))


def mark_job_success(conn: Connection, crawl_job_id: UUID) -> None:
    conn.execute(
        "UPDATE crawl_jobs SET status = 'SUCCESS', finished_at = %s WHERE crawl_job_id = %s",
        (datetime.now(UTC), str(crawl_job_id)),
    )


def mark_job_failed(conn: Connection, crawl_job_id: UUID, error_message: str, *, retryable: bool) -> None:
    status: CrawlJobStatus = CrawlJobStatus.RETRY if retryable else CrawlJobStatus.FAILED
    conn.execute(
        "UPDATE crawl_jobs SET status = %s, finished_at = %s, error_message = %s, "
        "retry_count = retry_count + 1 WHERE crawl_job_id = %s",
        (str(status), datetime.now(UTC), error_message[:2000], str(crawl_job_id)),
    )


def load_replayable_jobs(conn: Connection, organization_id: UUID | None = None) -> list[dict[str, Any]]:
    """The 'failed queue': crawl_jobs that failed but haven't exhausted their retry budget yet.
    No separate queue table — crawl_jobs already carries retry_count/max_retries, so this *is*
    the queue, filtered."""
    with conn.cursor(row_factory=dict_row) as cur:
        if organization_id is not None:
            cur.execute(
                "SELECT cj.crawl_job_id, cj.organization_id, cs.crawl_source_id, cs.url, cs.source_type "
                "FROM crawl_jobs cj JOIN crawl_sources cs ON cs.crawl_source_id = cj.crawl_source_id "
                "WHERE cj.status IN ('FAILED', 'RETRY') AND cj.retry_count < cj.max_retries "
                "AND cj.organization_id = %s",
                (str(organization_id),),
            )
        else:
            cur.execute(
                "SELECT cj.crawl_job_id, cj.organization_id, cs.crawl_source_id, cs.url, cs.source_type "
                "FROM crawl_jobs cj JOIN crawl_sources cs ON cs.crawl_source_id = cj.crawl_source_id "
                "WHERE cj.status IN ('FAILED', 'RETRY') AND cj.retry_count < cj.max_retries"
            )
        return list(cur.fetchall())


def _find_document_by_url(conn: Connection, organization_id: UUID, url: str) -> dict[str, Any] | None:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT document_id, checksum FROM documents "
            "WHERE organization_id = %s AND url = %s ORDER BY downloaded_at DESC LIMIT 1",
            (str(organization_id), url),
        )
        return cur.fetchone()


def _find_document_by_checksum(conn: Connection, organization_id: UUID, checksum: str) -> dict[str, Any] | None:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT document_id FROM documents WHERE organization_id = %s AND checksum = %s",
            (str(organization_id), checksum),
        )
        return cur.fetchone()


def _next_version_number(conn: Connection, document_id: UUID) -> int:
    row = conn.execute(
        "SELECT COALESCE(MAX(version_number), 0) + 1 FROM document_versions WHERE document_id = %s",
        (str(document_id),),
    ).fetchone()
    assert row is not None
    return int(row[0])


def store_fetched_document(
    conn: Connection,
    *,
    organization_id: UUID,
    crawl_job_id: UUID,
    source_type: str,
    fetched: FetchedDocument,
    settings: Settings,
) -> CollectionOutcome:
    checksum, path = save_content(
        settings.storage_root(), fetched.content, content_type=fetched.content_type, url=fetched.url
    )
    file_format = path.suffix.lstrip(".")
    existing_by_url = _find_document_by_url(conn, organization_id, fetched.url)

    if existing_by_url is not None and existing_by_url["checksum"] == checksum:
        log_processing(
            conn,
            organization_id=organization_id,
            stage="COLLECTION",
            message=f"Unchanged, skipped: {fetched.url}",
            level=LogLevel.DEBUG,
        )
        return CollectionOutcome(
            source_url=fetched.url,
            crawl_job_id=crawl_job_id,
            succeeded=True,
            document_id=UUID(str(existing_by_url["document_id"])),
            skipped_unchanged=True,
        )

    if existing_by_url is not None:
        # Same identity (org+url), content changed -> new version under the same document_id.
        document_id = UUID(str(existing_by_url["document_id"]))
        conn.execute(
            "UPDATE documents SET checksum = %s, storage_path = %s, file_format = %s, "
            "status = %s, downloaded_at = %s, crawl_job_id = %s WHERE document_id = %s",
            (
                checksum, str(path), file_format, str(DocumentStatus.DOWNLOADED),
                datetime.now(UTC), str(crawl_job_id), str(document_id),
            ),
        )
        version_number = _next_version_number(conn, document_id)
        conn.execute(
            "INSERT INTO document_versions (document_id, version_number, storage_path, checksum) "
            "VALUES (%s, %s, %s, %s)",
            (str(document_id), version_number, str(path), checksum),
        )
        log_processing(
            conn,
            organization_id=organization_id,
            stage="COLLECTION",
            message=f"Content changed, new version {version_number}: {fetched.url}",
            level=LogLevel.INFO,
        )
        return CollectionOutcome(
            source_url=fetched.url, crawl_job_id=crawl_job_id, succeeded=True,
            document_id=document_id, is_new_version=True,
        )

    # Brand new (org, url). documents also carries a real unique constraint on
    # (organization_id, checksum) -- checked here explicitly rather than relying on the DB to
    # reject it, so a collision never poisons a longer-lived transaction shared with other
    # writes (see engine.py for how connections/transactions are scoped per unit of work).
    existing_by_checksum = _find_document_by_checksum(conn, organization_id, checksum)
    if existing_by_checksum is not None:
        log_processing(
            conn,
            organization_id=organization_id,
            stage="COLLECTION",
            message=(
                f"Identical content already stored under another URL for this organization "
                f"(checksum {checksum[:12]}...); not duplicating. Fetched from: {fetched.url}"
            ),
            level=LogLevel.INFO,
        )
        return CollectionOutcome(
            source_url=fetched.url, crawl_job_id=crawl_job_id, succeeded=True,
            document_id=UUID(str(existing_by_checksum["document_id"])),
        )

    row = conn.execute(
        "INSERT INTO documents (organization_id, crawl_job_id, document_type, url, "
        "file_format, storage_path, checksum, status, downloaded_at) "
        "VALUES (%s, %s, %s::document_type, %s, %s, %s, %s, %s, %s) "
        "RETURNING document_id",
        (
            str(organization_id), str(crawl_job_id), source_type, fetched.url,
            file_format, str(path), checksum, str(DocumentStatus.DOWNLOADED),
            datetime.now(UTC),
        ),
    ).fetchone()
    assert row is not None
    document_id = UUID(str(row[0]))
    conn.execute(
        "INSERT INTO document_versions (document_id, version_number, storage_path, checksum) "
        "VALUES (%s, 1, %s, %s)",
        (str(document_id), str(path), checksum),
    )
    return CollectionOutcome(
        source_url=fetched.url, crawl_job_id=crawl_job_id, succeeded=True, document_id=document_id,
    )


def details_json(**kwargs: object) -> str:
    return json.dumps(kwargs, default=str)
