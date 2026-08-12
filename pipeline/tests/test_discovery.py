from __future__ import annotations

from uuid import uuid4

import pytest

from pipeline.config import Settings
from pipeline.discovery.engine import discover_sources
from pipeline.discovery.heuristics import all_candidates, official_website
from pipeline.enums import DocumentType
from pipeline.models import OrganizationRef


def make_org(**overrides: object) -> OrganizationRef:
    defaults: dict[str, object] = {
        "organization_id": uuid4(), "legal_name": "Test Bank Limited",
        "display_name": "Test Bank", "domain": "testbank.co.in", "cin_number": "U65100MH2000PLC123456",
    }
    defaults.update(overrides)
    return OrganizationRef(**defaults)  # type: ignore[arg-type]


def test_official_website_uses_domain_directly() -> None:
    org = make_org()
    candidate = official_website(org)
    assert candidate is not None
    assert candidate.url == "https://testbank.co.in"
    assert candidate.source_type == DocumentType.OFFICIAL_WEBSITE
    assert candidate.confidence > 0.9


def test_official_website_none_without_domain() -> None:
    org = make_org(domain=None)
    assert official_website(org) is None


def test_all_candidates_includes_regulator_sources_when_cin_present() -> None:
    org = make_org()
    candidates = all_candidates(org)
    assert any(c.source_type == DocumentType.GOVERNMENT_WEBSITE and "cin=" in c.url for c in candidates)


def test_all_candidates_skips_mca_without_cin() -> None:
    org = make_org(cin_number=None)
    candidates = all_candidates(org)
    assert not any("mca.gov.in" in c.url for c in candidates)


@pytest.mark.asyncio
async def test_discover_sources_filters_by_confidence_and_caps() -> None:
    org = make_org()
    settings = Settings(DATABASE_URL="postgresql://unused/unused", PIPELINE_DISCOVERY_MIN_CONFIDENCE=0.9, PIPELINE_DISCOVERY_MAX_SOURCES=1)
    result = await discover_sources(org, settings)
    assert result.total_after_filter <= 1
    assert all(c.confidence >= 0.9 for c in result.candidates)


@pytest.mark.asyncio
async def test_discover_sources_verifier_drops_dead_links() -> None:
    org = make_org()
    settings = Settings(DATABASE_URL="postgresql://unused/unused", PIPELINE_DISCOVERY_MIN_CONFIDENCE=0.01)

    async def verifier(url: str) -> int | None:
        return 404 if "investors" in url else 200

    result = await discover_sources(org, settings, verifier=verifier)
    assert not any("investors" in c.url for c in result.candidates)
    assert result.total_after_filter > 0
