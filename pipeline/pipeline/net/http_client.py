"""The one place plain HTTP fetches happen in this pipeline (Tech choices: "httpx for plain
HTTP"). Wraps httpx with robots.txt compliance, per-domain rate limiting, a real descriptive
User-Agent, and exponential backoff — every caller (discovery's optional verification pass,
collection's default HttpxFetcher) gets politeness for free instead of re-implementing it.
"""

from __future__ import annotations

from dataclasses import dataclass
from types import TracebackType

import httpx
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from pipeline.net.ratelimit import DomainRateLimiter
from pipeline.net.robots import RobotsCache


class RobotsDisallowed(Exception):
    """robots.txt forbids fetching this URL — never retried, never overridden."""


@dataclass(frozen=True)
class FetchResponse:
    url: str
    status_code: int
    content: bytes
    content_type: str | None
    final_url: str


class PoliteHttpClient:
    """Async context manager: `async with PoliteHttpClient(settings) as client: ...`"""

    def __init__(
        self,
        *,
        user_agent: str,
        per_domain_min_interval_s: float,
        per_domain_jitter_s: float,
        request_timeout_s: float,
        max_retries: int,
        backoff_base_s: float,
    ) -> None:
        self._user_agent = user_agent
        self._timeout_s = request_timeout_s
        self._max_retries = max_retries
        self._backoff_base_s = backoff_base_s
        self._robots = RobotsCache(user_agent, timeout_s=request_timeout_s)
        self._rate_limiter = DomainRateLimiter(per_domain_min_interval_s, per_domain_jitter_s)
        self._client = httpx.AsyncClient(follow_redirects=True, timeout=request_timeout_s)

    async def __aenter__(self) -> PoliteHttpClient:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        await self._client.aclose()

    async def get(self, url: str, *, respect_robots: bool = True) -> FetchResponse:
        if respect_robots and not await self._robots.can_fetch(url, self._client):
            raise RobotsDisallowed(f"robots.txt disallows fetching: {url}")

        @retry(
            reraise=True,
            stop=stop_after_attempt(self._max_retries),
            wait=wait_exponential(multiplier=self._backoff_base_s, min=self._backoff_base_s, max=60),
            retry=retry_if_exception_type((httpx.TransportError, httpx.HTTPStatusError)),
        )
        async def _do_get() -> FetchResponse:
            await self._rate_limiter.wait_turn(url)
            resp = await self._client.get(url, headers={"User-Agent": self._user_agent})
            if resp.status_code >= 500 or resp.status_code == 429:
                resp.raise_for_status()  # transient -> retried by tenacity
            return FetchResponse(
                url=url,
                status_code=resp.status_code,
                content=resp.content,
                content_type=resp.headers.get("content-type"),
                final_url=str(resp.url),
            )

        return await _do_get()

    async def head(self, url: str, *, respect_robots: bool = True) -> int | None:
        """Lightweight existence check (discovery's confidence-boosting verification pass).
        Returns the status code, or None if the request never completed (network failure,
        robots disallow) — a soft signal, never treated as fatal by the caller."""
        if respect_robots and not await self._robots.can_fetch(url, self._client):
            return None
        try:
            await self._rate_limiter.wait_turn(url)
            resp = await self._client.head(url, headers={"User-Agent": self._user_agent})
            return resp.status_code
        except httpx.HTTPError:
            return None
