"""robots.txt compliance (rule 5: "Respect robots.txt"). One cache entry per domain per process
run — a missing or unreadable robots.txt is treated as "allow" (the standard convention), a
robots.txt that explicitly disallows a path is always honored, no override.
"""

from __future__ import annotations

import urllib.robotparser
from urllib.parse import urlparse

import httpx


class RobotsCache:
    def __init__(self, user_agent: str, timeout_s: float = 10.0) -> None:
        self._user_agent = user_agent
        self._timeout_s = timeout_s
        self._parsers: dict[str, urllib.robotparser.RobotFileParser] = {}

    async def can_fetch(self, url: str, client: httpx.AsyncClient) -> bool:
        parsed = urlparse(url)
        origin = f"{parsed.scheme}://{parsed.netloc}"
        parser = self._parsers.get(origin)
        if parser is None:
            parser = urllib.robotparser.RobotFileParser()
            try:
                resp = await client.get(
                    f"{origin}/robots.txt",
                    timeout=self._timeout_s,
                    headers={"User-Agent": self._user_agent},
                )
                if resp.status_code >= 400:
                    parser.parse([])  # no robots.txt -> allow everything
                else:
                    parser.parse(resp.text.splitlines())
            except httpx.HTTPError:
                parser.parse([])  # unreachable -> fail open (standard convention), not a crawl block
            self._parsers[origin] = parser
        return parser.can_fetch(self._user_agent, url)
