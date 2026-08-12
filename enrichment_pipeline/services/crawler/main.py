"""crawler: consumes SeedJob from crawl-jobs, discovers and fetches real
source documents for each entity (official site, RBI/NABARD/BSE/NSE/MCA,
government sources, trusted financial data providers -- never Wikipedia,
blogs, forums, or AI-summary sites), and publishes a CrawledPayload to
translate-jobs.

If an entity genuinely has nothing findable, it still gets published with
`found_nothing=True` and zero documents -- downstream stages then write
"N/A" for every field rather than the entity silently vanishing from the
run. This is what "if you get nothing, leave it and move to the next
bank" means end-to-end: never block, but never drop the record either.

A job that raises an unexpected exception (e.g. the browser crashing) is
logged and left un-acked; the orchestrator's stale-message sweep will
reclaim and retry it, and eventually dead-letter it if it keeps failing --
the crawler itself never blocks on one bad job.
"""
from __future__ import annotations

import asyncio
import os
import sys
import time
from pathlib import Path

def _add_shared_to_path() -> None:
    """Locate the `shared` package regardless of layout: a sibling of this
    file inside the built Docker image (services/<name>/main.py is COPYed
    to /app/main.py, shared/ to /app/shared -- one level up), or two
    directories up when running this file directly from a source
    checkout (services/<name>/main.py -> enrichment_pipeline/shared)."""
    here = Path(__file__).resolve().parent
    for candidate in (here, *here.parents):
        if (candidate / "shared" / "__init__.py").exists():
            sys.path.insert(0, str(candidate))
            return
    raise RuntimeError(f"could not locate the 'shared' package from {here}")


_add_shared_to_path()

from pydantic import ValidationError  # noqa: E402

from fetcher import CrawlerFetcher, extract_report_links  # noqa: E402
from search import DuckDuckGoProvider, build_priority_queries, get_search_provider, is_blocked_domain, polite_delay  # noqa: E402
from shared.logging_events import EventLogger  # noqa: E402
from shared.models import CrawledPayload, FetchedDocument, SeedJob  # noqa: E402
from shared.queue_client import QueueClient, StreamMessage  # noqa: E402

STAGE = "crawler"
REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379/0")
RAW_DATA_DIR = os.environ.get("RAW_DATA_DIR", "/data/raw")
CRAWL_JOBS_STREAM = os.environ.get("CRAWL_JOBS_STREAM", "crawl-jobs")
TRANSLATE_JOBS_STREAM = os.environ.get("TRANSLATE_JOBS_STREAM", "translate-jobs")
GROUP = "crawler"
BATCH_SIZE = int(os.environ.get("CRAWLER_BATCH_SIZE", "5"))
MAX_DOCUMENTS_PER_ENTITY = int(os.environ.get("MAX_DOCUMENTS_PER_ENTITY", "6"))
MAX_QUERIES_PER_ENTITY = int(os.environ.get("MAX_QUERIES_PER_ENTITY", "6"))
MAX_RESULTS_PER_QUERY = int(os.environ.get("MAX_RESULTS_PER_QUERY", "5"))


async def process_job(job: SeedJob, fetcher: CrawlerFetcher, search_provider, evlog: EventLogger) -> CrawledPayload:
    queries = build_priority_queries(job.entity_name, job.state, job.entity_type)
    documents: list[FetchedDocument] = []
    tried_queries: list[str] = []
    seen_urls: set[str] = set()

    for query, source_tag, _tier in queries:
        if len(documents) >= MAX_DOCUMENTS_PER_ENTITY or len(tried_queries) >= MAX_QUERIES_PER_ENTITY:
            break
        tried_queries.append(query)
        try:
            if isinstance(search_provider, DuckDuckGoProvider):
                # Routed through the real browser -- see
                # CrawlerFetcher.search_duckduckgo's docstring for why
                # the plain-httpx DuckDuckGoProvider.search() path is
                # unreliable (bot-check interstitials) for this specific
                # free/no-key provider. Google CSE / Bing (official,
                # authenticated APIs) stay on the httpx path below.
                results = await fetcher.search_duckduckgo(query, MAX_RESULTS_PER_QUERY)
            else:
                results = await asyncio.to_thread(search_provider.search, query, MAX_RESULTS_PER_QUERY)
                await asyncio.to_thread(polite_delay)
        except Exception as exc:  # noqa: BLE001 - a bad search call must not abort the entity
            evlog.warning(f"search failed for query {query!r}: {exc}", entity_id=job.entity_id, entity_name=job.entity_name)
            results = []

        for result in results:
            if len(documents) >= MAX_DOCUMENTS_PER_ENTITY:
                break
            if not result.url or is_blocked_domain(result.url) or result.url in seen_urls:
                continue
            seen_urls.add(result.url)

            fetch_result = await fetcher.fetch(result.url)
            if not fetch_result.ok:
                evlog.debug(f"fetch failed for {result.url}: {fetch_result.error}", entity_id=job.entity_id, entity_name=job.entity_name)
                continue

            if fetch_result.is_pdf and fetch_result.pdf_bytes:
                local_path = fetcher.save_pdf(job.entity_id, result.url, fetch_result.pdf_bytes)
                documents.append(FetchedDocument(url=result.url, source_type="pdf", source_tag=source_tag, local_path=local_path))
                continue

            documents.append(FetchedDocument(url=fetch_result.final_url, source_type="html", source_tag=source_tag, text=fetch_result.text))

            # Follow one level deep from an official-site landing page into
            # its actual annual-report / AGM / financial-statement links.
            if source_tag == "official_site" and fetch_result.html:
                for link in extract_report_links(fetch_result.html, fetch_result.final_url):
                    if len(documents) >= MAX_DOCUMENTS_PER_ENTITY or link in seen_urls or is_blocked_domain(link):
                        continue
                    seen_urls.add(link)
                    sub_result = await fetcher.fetch(link)
                    if not sub_result.ok:
                        continue
                    if sub_result.is_pdf and sub_result.pdf_bytes:
                        local_path = fetcher.save_pdf(job.entity_id, link, sub_result.pdf_bytes)
                        documents.append(FetchedDocument(url=link, source_type="pdf", source_tag="official_site_report", local_path=local_path))
                    else:
                        documents.append(FetchedDocument(url=sub_result.final_url, source_type="html", source_tag="official_site_report", text=sub_result.text))

    return CrawledPayload(
        entity_id=job.entity_id, entity_name=job.entity_name, entity_type=job.entity_type,
        state=job.state, sector=job.sector, documents=documents,
        search_queries_tried=tried_queries, found_nothing=(len(documents) == 0),
    )


async def handle_message(
    msg: StreamMessage, fetcher: CrawlerFetcher, search_provider, queue: QueueClient, evlog: EventLogger
) -> None:
    if "__decode_error__" in msg.data:
        evlog.error("undecodable message on crawl-jobs, dead-lettering", details={"raw": msg.data})
        queue.dead_letter(CRAWL_JOBS_STREAM, GROUP, msg.id, msg.data, attempts=1, last_error="json decode error")
        queue.ack(CRAWL_JOBS_STREAM, GROUP, msg.id)
        return

    try:
        job = SeedJob.model_validate(msg.data)
    except ValidationError as exc:
        evlog.error(f"invalid SeedJob payload, dead-lettering: {exc}", details={"raw": msg.data})
        queue.dead_letter(CRAWL_JOBS_STREAM, GROUP, msg.id, msg.data, attempts=1, last_error=str(exc))
        queue.ack(CRAWL_JOBS_STREAM, GROUP, msg.id)
        return

    try:
        payload = await process_job(job, fetcher, search_provider, evlog)
        queue.publish(TRANSLATE_JOBS_STREAM, payload.model_dump())
        queue.ack(CRAWL_JOBS_STREAM, GROUP, msg.id)
        if payload.found_nothing:
            evlog.warning(
                f"nothing found for {job.entity_name} after {len(payload.search_queries_tried)} queries -- passing through as N/A",
                entity_id=job.entity_id, entity_name=job.entity_name,
            )
        else:
            evlog.info(
                f"crawled {job.entity_name}: {len(payload.documents)} document(s)",
                entity_id=job.entity_id, entity_name=job.entity_name, documents=len(payload.documents),
            )
    except Exception as exc:  # noqa: BLE001 - never crash the consumer loop on one bad job
        evlog.error(
            f"crawl failed for {job.entity_name}, leaving un-acked for orchestrator retry/dead-letter: {exc}",
            entity_id=job.entity_id, entity_name=job.entity_name,
        )
        # deliberately NOT acking: the orchestrator's XAUTOCLAIM sweep will
        # reclaim this message after it has been idle long enough, retry
        # it, and dead-letter it if it keeps failing.


async def async_main() -> None:
    queue = QueueClient(REDIS_URL, consumer_name="crawler")
    evlog = EventLogger(STAGE, queue)
    queue.ensure_group(CRAWL_JOBS_STREAM, GROUP)
    search_provider = get_search_provider()
    evlog.info("crawler starting", search_provider=search_provider.name)

    async with CrawlerFetcher(RAW_DATA_DIR) as fetcher:
        while True:
            try:
                messages = await asyncio.to_thread(queue.read_group, CRAWL_JOBS_STREAM, GROUP, BATCH_SIZE, 5000)
            except Exception as exc:  # noqa: BLE001 - transient redis hiccups must not kill the container
                evlog.error(f"failed to read from {CRAWL_JOBS_STREAM}: {exc}")
                await asyncio.sleep(3.0)
                continue

            if not messages:
                continue

            await asyncio.gather(
                *(handle_message(m, fetcher, search_provider, queue, evlog) for m in messages),
                return_exceptions=True,
            )


def main() -> None:
    while True:
        try:
            asyncio.run(async_main())
        except KeyboardInterrupt:
            return
        except Exception as exc:  # noqa: BLE001 - top-level container safety net
            logging_fallback = EventLogger(STAGE, QueueClient(REDIS_URL, consumer_name="crawler-restart"))
            logging_fallback.error(f"crawler crashed at top level, restarting in 5s: {exc}")
            time.sleep(5.0)


if __name__ == "__main__":
    main()
