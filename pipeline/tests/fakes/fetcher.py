"""A fake DocumentFetcher -- no network. Content is keyed by URL, so tests control exactly what
each source "downloads" without ever touching httpx/Camoufox."""

from __future__ import annotations

from pipeline.collection.fetcher import DocumentFetcher
from pipeline.collection.schema import FetchedDocument


class FakeFetcher(DocumentFetcher):
    def __init__(self, responses: dict[str, bytes], *, content_type: str = "text/html", fail_urls: set[str] | None = None) -> None:
        self._responses = responses
        self._content_type = content_type
        self._fail_urls = fail_urls or set()
        self.fetch_calls: list[str] = []

    async def fetch(self, url: str) -> FetchedDocument:
        self.fetch_calls.append(url)
        if url in self._fail_urls:
            raise ConnectionError(f"fake network failure for {url}")
        content = self._responses.get(url, b"<html><body>Default fake content.</body></html>")
        return FetchedDocument(url=url, final_url=url, content=content, content_type=self._content_type, status_code=200)
