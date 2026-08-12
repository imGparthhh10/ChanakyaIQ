"""DocumentFetcher: the swappable engine collection.engine depends on (Protocol, matching the
established convention in backend/src/modules/crawler/crawler.service.ts's own DocumentFetcher
interface — "isolated behind this interface so a real implementation is a one-file swap").

HttpxFetcher is the default and handles the large majority of sources (static HTML, PDFs) with
just plain HTTP — no browser needed. CamoufoxFetcher is the optional, lazily-imported engine for
the minority of sources that actually require JS rendering; selecting it never fails the whole
pipeline if camoufox isn't installed, it just isn't available (rule 2: heavy deps degrade loudly,
never crash). See judgment call in pipeline/README.md for why Httpx is the default rather than
Camoufox-always, given Tech choices explicitly says "Camoufox only where browser rendering is
actually needed."
"""

from __future__ import annotations

from typing import Protocol

from pipeline.collection.schema import FetchedDocument
from pipeline.net.http_client import PoliteHttpClient


class DocumentFetcher(Protocol):
    async def fetch(self, url: str) -> FetchedDocument: ...


class HttpxFetcher:
    """Plain-HTTP fetcher — HTML and PDF, no JS execution. Backed by PoliteHttpClient, so
    robots.txt / rate limiting / retries / backoff are already applied."""

    def __init__(self, client: PoliteHttpClient) -> None:
        self._client = client

    async def fetch(self, url: str) -> FetchedDocument:
        resp = await self._client.get(url)
        return FetchedDocument(
            url=url,
            final_url=resp.final_url,
            content=resp.content,
            content_type=resp.content_type,
            status_code=resp.status_code,
        )


class CamoufoxUnavailableError(RuntimeError):
    """Raised when CamoufoxFetcher is selected but the `camoufox` package isn't installed —
    caught by the orchestrator exactly like any other fetch failure (routed to the failed
    queue / manual review), never crashes the run."""


class CamoufoxFetcher:
    """JS-rendering fetcher for sources that don't return usable content over plain HTTP
    (client-side-rendered investor pages, some regulator portals). `camoufox` is an optional
    dependency (`pip install eip-pipeline[browser]`) — importing it happens lazily, inside
    fetch(), not at module load time, so the rest of the pipeline works with it absent."""

    def __init__(self, user_agent: str, timeout_s: float = 30.0) -> None:
        self._user_agent = user_agent
        self._timeout_s = timeout_s

    async def fetch(self, url: str) -> FetchedDocument:
        try:
            from camoufox.async_api import AsyncCamoufox
        except ImportError as exc:
            raise CamoufoxUnavailableError(
                "camoufox is not installed — install with `pip install eip-pipeline[browser]` "
                "to enable JS-rendered fetching. This source was not collected."
            ) from exc

        async with AsyncCamoufox(headless=True) as browser:
            page = await browser.new_page()
            try:
                await page.set_extra_http_headers({"User-Agent": self._user_agent})
                response = await page.goto(url, timeout=self._timeout_s * 1000)
                content = (await page.content()).encode("utf-8")
                status_code = response.status if response else 0
                final_url = page.url
            finally:
                await page.close()

        return FetchedDocument(
            url=url,
            final_url=final_url,
            content=content,
            content_type="text/html",
            status_code=status_code,
        )
