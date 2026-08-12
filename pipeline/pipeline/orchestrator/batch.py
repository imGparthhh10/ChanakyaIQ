"""Bounded concurrency across organizations (rule: "Concurrency across organizations with a
bounded worker pool"). Per-domain rate limiting is enforced by PoliteHttpClient's own
DomainRateLimiter regardless of how many organizations run concurrently -- see
pipeline_runner.run_for_organization, which creates one PoliteHttpClient per org run today
(a documented simplification: true cross-organization domain-limit sharing would need one
limiter instance threaded through every concurrent org's collection stage; see
pipeline/README.md's judgment calls for why this wasn't done and what it would take).
"""

from __future__ import annotations

import asyncio
from typing import Any
from uuid import UUID

from pipeline.config import Settings
from pipeline.orchestrator.pipeline_runner import run_for_organization


async def run_batch(organization_ids: list[UUID], settings: Settings) -> list[dict[str, Any]]:
    semaphore = asyncio.Semaphore(settings.max_concurrent_organizations)

    async def _run_one(org_id: UUID) -> dict[str, Any]:
        async with semaphore:
            return await run_for_organization(org_id, settings)

    return await asyncio.gather(*(_run_one(org_id) for org_id in organization_ids))
