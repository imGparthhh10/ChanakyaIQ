"""Per-domain rate limiting with jitter, enforced globally across every concurrent organization
worker (rule 5: "Be a polite crawler ... per-domain rate limiting with jitter"). One process-wide
instance is shared by every fetch, regardless of which organization or stage triggered it, so two
different orgs whose sources happen to share a domain (e.g. both filing with the same regulator
site) still can't exceed that domain's rate together.
"""

from __future__ import annotations

import asyncio
import random
import time
from urllib.parse import urlparse


class DomainRateLimiter:
    def __init__(self, min_interval_s: float, jitter_s: float) -> None:
        self._min_interval_s = min_interval_s
        self._jitter_s = jitter_s
        self._last_request_at: dict[str, float] = {}
        self._locks: dict[str, asyncio.Lock] = {}

    def _lock_for(self, domain: str) -> asyncio.Lock:
        if domain not in self._locks:
            self._locks[domain] = asyncio.Lock()
        return self._locks[domain]

    @staticmethod
    def domain_of(url: str) -> str:
        return urlparse(url).netloc.lower()

    async def wait_turn(self, url: str) -> None:
        domain = self.domain_of(url)
        lock = self._lock_for(domain)
        async with lock:
            now = time.monotonic()
            last = self._last_request_at.get(domain)
            if last is not None:
                elapsed = now - last
                wait_for = self._min_interval_s - elapsed + random.uniform(0, self._jitter_s)
                if wait_for > 0:
                    await asyncio.sleep(wait_for)
            self._last_request_at[domain] = time.monotonic()
