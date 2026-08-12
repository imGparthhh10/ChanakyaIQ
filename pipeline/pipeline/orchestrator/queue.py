"""The failed queue, made concrete: crawl_jobs rows with status FAILED/RETRY and
retry_count < max_retries (see collection/repository.load_replayable_jobs). Replaying re-fetches
each one through the same collection storage logic, so a document that succeeds on replay is
persisted exactly as if it had succeeded the first time -- no separate code path, no special
casing.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from pipeline.collection.fetcher import DocumentFetcher, HttpxFetcher
from pipeline.collection.repository import load_replayable_jobs, mark_job_failed, mark_job_success
from pipeline.collection.schema import CollectionOutcome
from pipeline.config import Settings
from pipeline.db.connection import get_connection
from pipeline.db.observability import log_processing
from pipeline.enums import LogLevel
from pipeline.net.http_client import PoliteHttpClient


async def replay_failed(organization_id: UUID | None, settings: Settings) -> list[CollectionOutcome]:
    with get_connection(settings) as conn:
        jobs = load_replayable_jobs(conn, organization_id)

    if not jobs:
        return []

    async with PoliteHttpClient(
        user_agent=settings.user_agent, per_domain_min_interval_s=settings.per_domain_min_interval_s,
        per_domain_jitter_s=settings.per_domain_jitter_s, request_timeout_s=settings.request_timeout_s,
        max_retries=settings.max_fetch_retries, backoff_base_s=settings.backoff_base_s,
    ) as http_client:
        fetcher: DocumentFetcher = HttpxFetcher(http_client)
        outcomes = []
        for job in jobs:
            outcomes.append(await _replay_one(job, fetcher, settings))
    return outcomes


async def _replay_one(job: dict[str, Any], fetcher: DocumentFetcher, settings: Settings) -> CollectionOutcome:
    from pipeline.collection.repository import store_fetched_document

    try:
        fetched = await fetcher.fetch(job["url"])
    except Exception as exc:  # noqa: BLE001
        with get_connection(settings) as conn:
            mark_job_failed(conn, job["crawl_job_id"], str(exc), retryable=True)
            log_processing(
                conn, organization_id=job["organization_id"], stage="COLLECTION_REPLAY",
                message=f"Replay failed again: {job['url']} ({exc})", level=LogLevel.WARN,
            )
        return CollectionOutcome(source_url=job["url"], crawl_job_id=job["crawl_job_id"], succeeded=False, error_message=str(exc))

    with get_connection(settings) as conn:
        outcome = store_fetched_document(
            conn, organization_id=job["organization_id"], crawl_job_id=job["crawl_job_id"],
            source_type=str(job["source_type"]), fetched=fetched, settings=settings,
        )
        mark_job_success(conn, job["crawl_job_id"])
        log_processing(
            conn, organization_id=job["organization_id"], stage="COLLECTION_REPLAY",
            message=f"Replay succeeded: {job['url']}", level=LogLevel.INFO,
        )
    return outcome
