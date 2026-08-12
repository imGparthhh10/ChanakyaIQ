"""Camoufox-backed page/PDF fetcher.

One AsyncCamoufox browser is launched per container lifetime (relaunching
per job would be far too slow); every URL fetch opens its own page/tab,
guarded by a process-wide `asyncio.Semaphore(10)` so no more than 10 tabs
are ever open concurrently, exactly as specified. Each fetch gets its own
randomized human-like delay before navigating and up to 3 retries with
exponential backoff on failure; a URL that still fails after 3 attempts
is skipped (logged, not fatal) so one bad source never blocks the rest of
an entity's crawl, let alone the rest of the pipeline.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import random
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

log = logging.getLogger("crawler.fetcher")

MAX_CONCURRENT_TABS = 10
MAX_ATTEMPTS = 3
NAV_TIMEOUT_MS = 25_000
MAX_HTML_TEXT_CHARS = 300_000
# Playwright's `timeout=` kwarg only bounds the specific call it's passed
# to (goto()). It does NOT bound page.close(), page.content(),
# response.body(), or new_page() -- and under Camoufox, after a long
# run with thousands of tab open/close cycles, a content process can
# wedge and one of those calls (page.close() in particular) hangs
# forever. That permanently eats one of the 10 concurrent-tab semaphore
# slots; enough of those over hours and the whole crawler goes silent
# while still burning CPU (confirmed live: 28+ minutes with zero log
# output, browser process still churning). ATTEMPT_HARD_TIMEOUT_S wraps
# the *entire* per-attempt body so nothing inside it can hang past this
# regardless of which specific call is stuck; PAGE_CLOSE_TIMEOUT_S
# bounds close() specifically (including during a cancellation unwind)
# so a wedged tab is abandoned/leaked rather than blocking forever.
ATTEMPT_HARD_TIMEOUT_S = 45
PAGE_CLOSE_TIMEOUT_S = 8
FINGERPRINT_OS_CHOICES = ["windows", "macos", "linux"]


def _ensure_camoufox_installed() -> None:
    """Defensive fallback: the Dockerfile already installs camoufox and
    pre-fetches its browser binary at build time, so this should be a
    no-op in the shipped image. It exists so main.py also works if run
    outside the container (e.g. local dev) against a fresh environment."""
    try:
        import camoufox  # noqa: F401
        return
    except ImportError:
        log.warning("camoufox not importable -- installing at runtime (this should only happen outside the prebuilt image)")
        subprocess.run([sys.executable, "-m", "pip", "install", "camoufox[geoip]"], check=True)
        subprocess.run([sys.executable, "-m", "camoufox", "fetch"], check=True)


REPORT_LINK_KEYWORDS = (
    "annual report", "agm", "annual general meeting", "financial statement",
    "financial results", "balance sheet", "disclosure", "brr", "sustainability report",
)


@dataclass
class FetchResult:
    ok: bool
    is_pdf: bool = False
    text: str = ""
    html: str = ""
    pdf_bytes: Optional[bytes] = None
    status: Optional[int] = None
    error: Optional[str] = None
    final_url: str = ""


def extract_report_links(html: str, base_url: str, max_links: int = 5) -> list[str]:
    """Scan a fetched HTML page for links whose text/href look like they
    point at an annual report / AGM report / financial statement (PDF or
    otherwise), so the crawler can follow one level deep from an official
    site's landing page into its actual disclosures."""
    from urllib.parse import urljoin

    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "lxml")
    found: list[str] = []
    seen: set[str] = set()
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if not href or href.startswith(("mailto:", "javascript:", "#")):
            continue
        label = (a.get_text(strip=True) + " " + href).lower()
        if any(kw in label for kw in REPORT_LINK_KEYWORDS) or href.lower().endswith(".pdf"):
            full_url = urljoin(base_url, href)
            if full_url not in seen:
                seen.add(full_url)
                found.append(full_url)
        if len(found) >= max_links:
            break
    return found


async def _safe_close(page) -> None:
    """page.close() with a hard timeout -- see ATTEMPT_HARD_TIMEOUT_S's
    comment. Always returns within PAGE_CLOSE_TIMEOUT_S; a page that
    won't close is abandoned (leaked, browser process stays alive)
    rather than allowed to block the semaphore slot forever."""
    try:
        await asyncio.wait_for(page.close(), timeout=PAGE_CLOSE_TIMEOUT_S)
    except Exception as exc:  # noqa: BLE001 - closing must never hang or crash the caller
        log.warning("page.close() failed/timed out after %ss (leaking this tab): %s", PAGE_CLOSE_TIMEOUT_S, exc)


class CrawlerFetcher:
    def __init__(self, raw_data_dir: str) -> None:
        _ensure_camoufox_installed()
        self.raw_data_dir = Path(raw_data_dir)
        self.raw_data_dir.mkdir(parents=True, exist_ok=True)
        self._semaphore = asyncio.Semaphore(MAX_CONCURRENT_TABS)
        self._browser_cm = None
        self._browser = None

    async def __aenter__(self) -> "CrawlerFetcher":
        from camoufox.async_api import AsyncCamoufox

        os_choice = random.choice(FINGERPRINT_OS_CHOICES)
        self._browser_cm = AsyncCamoufox(headless=True, humanize=True, os=os_choice, geoip=True)
        self._browser = await self._browser_cm.__aenter__()
        log.info("camoufox browser launched (fingerprint os=%s)", os_choice)
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        if self._browser_cm is not None:
            await self._browser_cm.__aexit__(exc_type, exc, tb)

    async def search_duckduckgo(self, query: str, max_results: int = 8):
        """Runs a DuckDuckGo HTML-lite search through the real Camoufox
        browser instead of a raw HTTP client. Confirmed during live
        testing: DuckDuckGo's endpoint returns HTTP 202 bot-check
        interstitials (not real results) to plain httpx requests from
        this environment's outbound IP essentially every time, but a
        genuine browser navigation -- with a real TLS/JS fingerprint --
        gets real results reliably. This is why the crawler drives
        DuckDuckGo through here rather than through
        `search.DuckDuckGoProvider` (kept only as a fallback / for local
        non-Docker testing)."""
        from search import parse_duckduckgo_html

        assert self._browser is not None
        last_error = "unknown"
        for attempt in range(1, MAX_ATTEMPTS + 1):
            async with self._semaphore:
                await asyncio.sleep(random.uniform(2.0, 6.0))
                try:
                    result = await asyncio.wait_for(self._search_duckduckgo_once(query, max_results), timeout=ATTEMPT_HARD_TIMEOUT_S)
                    if result:
                        return result
                    last_error = "parsed 0 results"
                except asyncio.TimeoutError:
                    last_error = f"attempt hard-timed-out after {ATTEMPT_HARD_TIMEOUT_S}s (browser likely wedged)"
                    log.warning("browser search attempt %d/%d hard-timed-out for %r", attempt, MAX_ATTEMPTS, query)
                except Exception as exc:  # noqa: BLE001 - one bad search must not crash the crawler
                    last_error = str(exc)
                    log.warning("browser search attempt %d/%d failed for %r: %s", attempt, MAX_ATTEMPTS, query, exc)
            if attempt < MAX_ATTEMPTS:
                await asyncio.sleep((2 ** attempt) + random.uniform(0, 1.5))
        log.warning("browser-based duckduckgo search exhausted retries for %r: %s", query, last_error)
        return []

    async def _search_duckduckgo_once(self, query: str, max_results: int):
        from urllib.parse import urlencode

        from search import parse_duckduckgo_html

        page = await self._browser.new_page(no_viewport=True)
        try:
            url = "https://html.duckduckgo.com/html/?" + urlencode({"q": query})
            response = await page.goto(url, timeout=NAV_TIMEOUT_MS, wait_until="domcontentloaded")
            if response is None:
                return []
            html = await page.content()
            return parse_duckduckgo_html(html, max_results)
        finally:
            await _safe_close(page)

    async def fetch(self, url: str) -> FetchResult:
        last_error = "unknown"
        for attempt in range(1, MAX_ATTEMPTS + 1):
            async with self._semaphore:
                await asyncio.sleep(random.uniform(2.0, 6.0))  # polite, human-like pacing
                try:
                    return await asyncio.wait_for(self._fetch_once(url), timeout=ATTEMPT_HARD_TIMEOUT_S)
                except asyncio.TimeoutError:
                    last_error = f"attempt hard-timed-out after {ATTEMPT_HARD_TIMEOUT_S}s (browser likely wedged)"
                    log.warning("fetch attempt %d/%d hard-timed-out for %s", attempt, MAX_ATTEMPTS, url)
                except Exception as exc:  # noqa: BLE001 - one URL must never crash the crawler
                    last_error = str(exc)
                    log.warning("fetch attempt %d/%d failed for %s: %s", attempt, MAX_ATTEMPTS, url, exc)
            if attempt < MAX_ATTEMPTS:
                await asyncio.sleep((2 ** attempt) + random.uniform(0, 1.5))
        return FetchResult(ok=False, error=last_error, final_url=url)

    async def _fetch_once(self, url: str) -> FetchResult:
        assert self._browser is not None
        # no_viewport=True: Playwright's default new_page() call sends a
        # full default viewport descriptor (including `isMobile`) over
        # CDP. Camoufox's Firefox-based CDP-compat layer doesn't
        # recognize that field and rejects the call outright with
        # "Protocol error (Browser.setDefaultViewport)" -- every single
        # page creation fails without this flag. no_viewport=True skips
        # that emulated-viewport handshake entirely (uses the real OS
        # window size instead), which Camoufox accepts.
        page = await self._browser.new_page(no_viewport=True)
        try:
            response = await page.goto(url, timeout=NAV_TIMEOUT_MS, wait_until="domcontentloaded")
            if response is None:
                return FetchResult(ok=False, error="no response object", final_url=url)

            status = response.status
            content_type = (response.headers or {}).get("content-type", "").lower()
            final_url = page.url or url

            if "application/pdf" in content_type or final_url.lower().split("?")[0].endswith(".pdf"):
                body = await response.body()
                return FetchResult(ok=True, is_pdf=True, pdf_bytes=body, status=status, final_url=final_url)

            if status >= 400:
                return FetchResult(ok=False, status=status, error=f"http {status}", final_url=final_url)

            html = await page.content()
            text = self._html_to_text(html)
            return FetchResult(
                ok=True, is_pdf=False, text=text[:MAX_HTML_TEXT_CHARS],
                html=html[:MAX_HTML_TEXT_CHARS * 2], status=status, final_url=final_url,
            )
        finally:
            await _safe_close(page)

    @staticmethod
    def _html_to_text(html: str) -> str:
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(html, "lxml")
        for tag in soup(["script", "style", "noscript", "svg"]):
            tag.decompose()
        return soup.get_text(separator=" ", strip=True)

    def save_pdf(self, entity_id: str, url: str, pdf_bytes: bytes) -> str:
        entity_dir = self.raw_data_dir / entity_id
        entity_dir.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:12]
        path = entity_dir / f"{digest}.pdf"
        path.write_bytes(pdf_bytes)
        return str(path)
