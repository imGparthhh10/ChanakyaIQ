"""Stage 2 entry point. One DB connection/transaction per source (not one giant transaction
for the whole organization) -- a long crawl shouldn't hold a single Postgres transaction open
for its entire duration, and it means one source's failure can never roll back another
source's already-committed success.

Retry policy: PoliteHttpClient (used by HttpxFetcher) already retries transient network/5xx/429
failures within a single fetch() call. This engine's retry loop is the coarser, job-level retry
the spec asks for ("retry up to 3 times with backoff; if still failing, push to a failed queue")
-- each attempt here is a fresh fetch() call (which may itself have retried internally), and
after `max_fetch_retries` such attempts, the crawl_job is left FAILED for the replay command to
pick up later. Nothing is lost -- see repository.load_replayable_jobs.
"""

from __future__ import annotations

import asyncio
from uuid import UUID

from pipeline.collection.fetcher import DocumentFetcher
from pipeline.collection.repository import (
    create_crawl_job,
    load_active_sources,
    mark_job_failed,
    mark_job_success,
    store_fetched_document,
)
from pipeline.collection.schema import CollectionOutcome
from pipeline.config import Settings
from pipeline.db.connection import get_connection
from pipeline.db.observability import log_processing, record_error
from pipeline.enums import LogLevel

_WORKER_NAME = "CollectionWorker"


async def _fetch_with_retries(
    fetcher: DocumentFetcher, url: str, *, max_attempts: int, backoff_base_s: float
) -> tuple[object | None, str | None]:
    """Returns (FetchedDocument, None) on success or (None, last_error_message) after
    exhausting attempts. Each attempt is independent -- HttpxFetcher already retries transient
    errors internally, so a failure reaching here means the *whole* fetch (with its own
    internal retries) failed, and this is the job-level retry around that."""
    last_error: str | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            return await fetcher.fetch(url), None
        except Exception as exc:  # noqa: BLE001 -- any fetch failure is retryable at this level
            last_error = f"{type(exc).__name__}: {exc}"
            if attempt < max_attempts:
                await asyncio.sleep(backoff_base_s * attempt)
    return None, last_error


async def collect_for_organization(
    organization_id: UUID,
    fetcher: DocumentFetcher,
    settings: Settings,
) -> list[CollectionOutcome]:
    with get_connection(settings) as conn:
        sources = load_active_sources(conn, organization_id)

    if not sources:
        with get_connection(settings) as conn:
            log_processing(
                conn, organization_id=organization_id, stage="COLLECTION",
                message="No active crawl_sources found -- run discovery first.",
                level=LogLevel.WARN,
            )
        return []

    outcomes: list[CollectionOutcome] = []
    for source in sources:
        outcome = await _collect_one_source(organization_id, source, fetcher, settings)
        outcomes.append(outcome)
    return outcomes


async def _collect_one_source(organization_id: UUID, source, fetcher: DocumentFetcher, settings: Settings) -> CollectionOutcome:  # type: ignore[no-untyped-def]
    with get_connection(settings) as conn:
        crawl_job_id = create_crawl_job(conn, organization_id, source.crawl_source_id)

    try:
        return await _fetch_and_store(organization_id, source, crawl_job_id, fetcher, settings)
    except asyncio.CancelledError:
        # Graceful shutdown mid-fetch: leave a RETRY-eligible job, not one stuck in RUNNING
        # forever (rule: "Graceful shutdown that leaves no job stuck in RUNNING").
        with get_connection(settings) as conn:
            mark_job_failed(conn, crawl_job_id, "cancelled (graceful shutdown)", retryable=True)
        raise


async def _fetch_and_store(organization_id: UUID, source, crawl_job_id: UUID, fetcher: DocumentFetcher, settings: Settings) -> CollectionOutcome:  # type: ignore[no-untyped-def]
    fetched, error_message = await _fetch_with_retries(
        fetcher, source.url,
        max_attempts=settings.max_fetch_retries,
        backoff_base_s=settings.backoff_base_s,
    )

    if fetched is None:
        with get_connection(settings) as conn:
            mark_job_failed(conn, crawl_job_id, error_message or "unknown fetch failure", retryable=False)
            log_processing(
                conn, organization_id=organization_id, stage="COLLECTION",
                message=f"Failed after {settings.max_fetch_retries} attempts: {source.url} ({error_message})",
                level=LogLevel.WARN,
            )
        return CollectionOutcome(
            source_url=source.url, crawl_job_id=crawl_job_id, succeeded=False, error_message=error_message,
        )

    with get_connection(settings) as conn:
        try:
            outcome = store_fetched_document(
                conn,
                organization_id=organization_id,
                crawl_job_id=crawl_job_id,
                source_type=str(source.source_type),
                fetched=fetched,  # type: ignore[arg-type]
                settings=settings,
            )
            mark_job_success(conn, crawl_job_id)
            return outcome
        except Exception as exc:  # noqa: BLE001 -- persisted to errors, never crashes the run
            record_error(conn, organization_id=organization_id, worker_name=_WORKER_NAME, error_type="StorageError", exc=exc)
            mark_job_failed(conn, crawl_job_id, str(exc), retryable=False)
            return CollectionOutcome(
                source_url=source.url, crawl_job_id=crawl_job_id, succeeded=False, error_message=str(exc),
            )
