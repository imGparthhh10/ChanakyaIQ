"""Stage 1 entry point: heuristic candidate generation, optional live verification, then
dedupe/filter/rank/cap into the final list that repository.py persists to crawl_sources.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from pipeline.config import Settings
from pipeline.discovery.heuristics import all_candidates
from pipeline.discovery.schema import DiscoveryResult, SourceCandidate
from pipeline.models import OrganizationRef

# A verifier does a cheap existence check (e.g. HTTP HEAD) and returns a status code, or None
# if it couldn't determine one — matches PoliteHttpClient.head's signature. Optional: with none
# supplied, discovery runs purely on heuristic confidence and no network I/O happens at all,
# which is what makes this stage testable without a network connection.
Verifier = Callable[[str], Awaitable[int | None]]

_VERIFIED_BOOST = 0.3
_VERIFIED_CAP = 0.99
_DEAD_LINK_STATUSES = {404, 410}


async def _verify(candidates: list[SourceCandidate], verifier: Verifier) -> list[SourceCandidate]:
    out: list[SourceCandidate] = []
    for c in candidates:
        status = await verifier(c.url)
        if status is not None and status in _DEAD_LINK_STATUSES:
            continue  # confirmed dead — don't hand a 404 downstream to the collection stage
        if status is not None and 200 <= status < 400:
            c = c.model_copy(update={"confidence": min(c.confidence + _VERIFIED_BOOST, _VERIFIED_CAP)})
        out.append(c)
    return out


def _dedupe_keep_best(candidates: list[SourceCandidate]) -> list[SourceCandidate]:
    best_by_url: dict[str, SourceCandidate] = {}
    for c in candidates:
        existing = best_by_url.get(c.url)
        if existing is None or c.confidence > existing.confidence:
            best_by_url[c.url] = c
    return list(best_by_url.values())


async def discover_sources(
    org: OrganizationRef,
    settings: Settings,
    *,
    verifier: Verifier | None = None,
) -> DiscoveryResult:
    generated = all_candidates(org)
    total_generated = len(generated)

    candidates = await _verify(generated, verifier) if verifier is not None else generated
    candidates = _dedupe_keep_best(candidates)
    candidates = [c for c in candidates if c.confidence >= settings.discovery_min_confidence]
    candidates.sort(key=lambda c: c.confidence, reverse=True)
    candidates = candidates[: settings.discovery_max_sources_per_org]

    return DiscoveryResult(
        organization_id=org.organization_id,
        candidates=candidates,
        total_generated=total_generated,
        total_after_filter=len(candidates),
    )
