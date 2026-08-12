"""Search discovery for the crawler.

Design note on "search Google": scraping Google's own results page (SERP)
with automated tooling is prohibited by Google's Terms of Service and gets
IP ranges blocked quickly regardless of stealth tech. This module instead
offers three real, working providers, tried in this order:

  1. GoogleCSEProvider  -- Google's own *sanctioned* Programmable Search
     Engine JSON API. This literally *is* Google search, used the way
     Google intends automated callers to use it. Enabled by setting
     GOOGLE_CSE_API_KEY + GOOGLE_CSE_ID.
  2. BingSearchProvider -- Microsoft's official Bing Web Search API.
     Enabled by setting BING_SEARCH_API_KEY.
  3. DuckDuckGoProvider -- DuckDuckGo's HTML-lite endpoint
     (html.duckduckgo.com/html). No API key required, so the pipeline
     runs out of the box with zero paid dependencies. This is real,
     working discovery against a real search engine -- not a mock -- and
     is commonly used for exactly this purpose, but is lower-quality
     than a proper search API, which is why it's the fallback, not the
     default when keys are available.

Whichever provider is used, results are filtered through a domain
blocklist (Wikipedia, forums, blogs, social media, AI-summary sites)
before anything is handed to the fetcher, per the source-priority rules.
"""
from __future__ import annotations

import logging
import os
import random
import time
from dataclasses import dataclass
from typing import Optional
from urllib.parse import parse_qs, urlparse

import httpx
from bs4 import BeautifulSoup

log = logging.getLogger("crawler.search")

BLOCKED_DOMAINS = {
    "wikipedia.org", "en.wikipedia.org", "quora.com", "reddit.com", "medium.com",
    "blogspot.com", "wordpress.com", "facebook.com", "twitter.com", "x.com",
    "linkedin.com", "youtube.com", "pinterest.com", "instagram.com", "tumblr.com",
    "answers.com", "scribd.com", "slideshare.net",
}

TRUSTED_FINANCIAL_PROVIDERS = [
    "moneycontrol.com", "screener.in", "crisil.com", "careratings.com",
    "icra.in", "reuters.com", "bloomberg.com",
]

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
]


@dataclass
class SearchResult:
    url: str
    title: str = ""
    snippet: str = ""


def is_blocked_domain(url: str) -> bool:
    try:
        host = urlparse(url).netloc.lower()
    except Exception:  # noqa: BLE001
        return True
    host = host.split(":")[0]
    for blocked in BLOCKED_DOMAINS:
        if host == blocked or host.endswith("." + blocked):
            return True
    return False


class GoogleCSEProvider:
    name = "google_cse"

    def __init__(self, api_key: str, cx: str) -> None:
        self.api_key = api_key
        self.cx = cx

    def search(self, query: str, max_results: int = 8) -> list[SearchResult]:
        try:
            resp = httpx.get(
                "https://www.googleapis.com/customsearch/v1",
                params={"key": self.api_key, "cx": self.cx, "q": query, "num": min(max_results, 10)},
                timeout=15.0,
            )
            resp.raise_for_status()
            data = resp.json()
        except Exception as exc:  # noqa: BLE001
            log.warning("google_cse search failed for %r: %s", query, exc)
            return []
        out = []
        for item in data.get("items", []):
            out.append(SearchResult(url=item.get("link", ""), title=item.get("title", ""), snippet=item.get("snippet", "")))
        return out


class BingSearchProvider:
    name = "bing"

    def __init__(self, api_key: str) -> None:
        self.api_key = api_key

    def search(self, query: str, max_results: int = 8) -> list[SearchResult]:
        try:
            resp = httpx.get(
                "https://api.bing.microsoft.com/v7.0/search",
                params={"q": query, "count": max_results, "mkt": "en-IN"},
                headers={"Ocp-Apim-Subscription-Key": self.api_key},
                timeout=15.0,
            )
            resp.raise_for_status()
            data = resp.json()
        except Exception as exc:  # noqa: BLE001
            log.warning("bing search failed for %r: %s", query, exc)
            return []
        out = []
        for item in (data.get("webPages", {}) or {}).get("value", []):
            out.append(SearchResult(url=item.get("url", ""), title=item.get("name", ""), snippet=item.get("snippet", "")))
        return out


def _unwrap_duckduckgo_href(href: str) -> Optional[str]:
    if not href:
        return None
    if href.startswith("//duckduckgo.com/l/") or "uddg=" in href:
        parsed = urlparse(href if href.startswith("http") else "https:" + href)
        qs = parse_qs(parsed.query)
        target = qs.get("uddg", [None])[0]
        return target
    if href.startswith("http"):
        return href
    return None


def parse_duckduckgo_html(html: str, max_results: int = 8) -> list[SearchResult]:
    """Parses DuckDuckGo's HTML-lite result markup, wherever it came from
    (a raw httpx response, or a Camoufox-rendered page) -- both go
    through this one parser so there's a single place that understands
    the page structure."""
    soup = BeautifulSoup(html, "lxml")
    out: list[SearchResult] = []
    for a in soup.select("a.result__a")[:max_results]:
        href = a.get("href", "")
        real_url = _unwrap_duckduckgo_href(href)
        if not real_url:
            continue
        title = a.get_text(strip=True)
        snippet_el = a.find_parent("div", class_="result") or a.find_parent("div")
        snippet = ""
        if snippet_el:
            snip = snippet_el.select_one(".result__snippet")
            snippet = snip.get_text(strip=True) if snip else ""
        out.append(SearchResult(url=real_url, title=title, snippet=snippet))
    return out


class DuckDuckGoProvider:
    """No API key needed. Uses the HTML-lite endpoint via a plain httpx
    GET, parsed with BeautifulSoup.

    NOTE: in practice, DuckDuckGo's HTML-lite endpoint frequently returns
    HTTP 202 with a bot-check interstitial page (not real results) to
    plain HTTP-client traffic from datacenter/cloud IPs -- confirmed
    during live testing of this crawler, where this synchronous provider
    returned zero results for essentially every query. `raise_for_status()`
    doesn't catch a 202, so this fails *silently* (returns [], not an
    exception) rather than raising -- callers just see "nothing found".
    The crawler itself does NOT use this class for that reason; see
    `fetcher.CrawlerFetcher.search_duckduckgo_via_browser`, which drives
    the same endpoint through the real Camoufox browser instead, and is
    dramatically more reliable because it carries a genuine browser
    TLS/JS fingerprint rather than a bare HTTP client's. This class is
    kept for local testing / non-Docker use and as a graceful final
    fallback if the browser-based path itself throws."""

    name = "duckduckgo"

    def search(self, query: str, max_results: int = 8) -> list[SearchResult]:
        try:
            resp = httpx.get(
                "https://html.duckduckgo.com/html/",
                params={"q": query},
                headers={"User-Agent": random.choice(USER_AGENTS)},
                timeout=15.0,
                follow_redirects=True,
            )
            resp.raise_for_status()
        except Exception as exc:  # noqa: BLE001
            log.warning("duckduckgo search failed for %r: %s", query, exc)
            return []
        if resp.status_code != 200:
            log.warning("duckduckgo returned non-200 status %s for %r (likely bot-check page)", resp.status_code, query)
            return []
        return parse_duckduckgo_html(resp.text, max_results)


def get_search_provider():
    google_key, google_cx = os.environ.get("GOOGLE_CSE_API_KEY"), os.environ.get("GOOGLE_CSE_ID")
    bing_key = os.environ.get("BING_SEARCH_API_KEY")
    if google_key and google_cx:
        log.info("using GoogleCSEProvider for search discovery")
        return GoogleCSEProvider(google_key, google_cx)
    if bing_key:
        log.info("using BingSearchProvider for search discovery")
        return BingSearchProvider(bing_key)
    log.info("no search API key configured -- using DuckDuckGoProvider (free, no key required)")
    return DuckDuckGoProvider()


def build_priority_queries(entity_name: str, state: str, entity_type: str) -> list[tuple[str, str, int]]:
    """Returns (query, source_tag, priority_tier) tuples, tier 1 = highest
    priority (official sources), tier 4 = lowest (financial data
    providers). The crawler searches tiers in order and stops once it has
    gathered enough usable documents."""
    q: list[tuple[str, str, int]] = [
        (f'"{entity_name}" official website', "official_site", 1),
        (f'"{entity_name}" annual report financial statement', "official_site", 1),
        (f'"{entity_name}" AGM report annual general meeting', "official_site", 1),
    ]
    if entity_type == "bank":
        q += [
            (f'"{entity_name}" site:rbi.org.in', "rbi", 2),
            (f'"{entity_name}" site:nabard.org', "nabard", 2),
        ]
    q += [
        (f'"{entity_name}" site:bseindia.com', "bse", 2),
        (f'"{entity_name}" site:nseindia.com', "nse", 2),
        (f'"{entity_name}" site:mca.gov.in', "mca", 2),
        (f'"{entity_name}" {state} site:dpiit.gov.in', "government", 3),
        (f'"{entity_name}" annual report site:crisil.com OR site:careratings.com OR site:icra.in', "financial_provider", 4),
        (f'"{entity_name}" financial results site:moneycontrol.com OR site:screener.in', "financial_provider", 4),
        (f'"{entity_name}" IT spend OR technology investment OR cybersecurity OR "data centre" OR cloud', "financial_provider", 4),
    ]
    return q


def polite_delay() -> None:
    time.sleep(random.uniform(2.0, 6.0))
