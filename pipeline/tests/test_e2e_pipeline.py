"""End-to-end: the whole pipeline (stages 1-9) against a temp Postgres database, with a fake
fetcher (no network) and a fake LLM engine (no Anthropic API call). Run twice to prove
idempotency -- rule 3: "Re-running the pipeline on the same organization must not duplicate
rows."
"""

from __future__ import annotations

from uuid import UUID, uuid4

import psycopg
import pytest

from pipeline.config import Settings
from pipeline.enums import OrgStatus
from pipeline.orchestrator.pipeline_runner import run_for_organization
from tests.fakes.fetcher import FakeFetcher
from tests.fakes.icp_client import FakeBackendClient
from tests.fakes.llm import FakeExtractionEngine, make_fake_profile

RICH_HTML = b"""<html><head><title>Test Bank - Investor Relations</title></head><body>
<p>Test Bank Limited reported revenue of Rs 500 Crore this fiscal year, per our Annual Report.</p>
<p>Our CEO Jane Doe leads a team operating 120 branches across India.</p>
<p>We partnered with Acme Fintech Partners and run our core banking platform on AWS cloud infrastructure.</p>
<p>Test Bank won Best Digital Bank 2024 for our digital transformation initiatives.</p>
</body></html>"""


def _seed_organization(conn: psycopg.Connection, *, domain: str) -> UUID:
    org_id = uuid4()
    conn.execute(
        "INSERT INTO organizations (organization_id, legal_name, domain, status) "
        "VALUES (%s, %s, %s, 'NEW'::org_status)",
        (str(org_id), "Test Bank Limited", domain),
    )
    conn.execute(
        "INSERT INTO metric_definitions (metric_key, display_name, category) "
        "VALUES ('revenue', 'Revenue', 'Financial'::metric_category) "
        "ON CONFLICT (metric_key) DO NOTHING"
    )
    conn.commit()
    return org_id


def _seed_icp_outcome(conn: psycopg.Connection, org_id: UUID) -> None:
    """Simulates what the Node backend's real POST /icp/run would have written -- the e2e test
    fakes the HTTP call itself (no Node server running here), but stage 9 reads this DB state
    back regardless of who wrote it."""
    conn.execute(
        "UPDATE organizations SET icp_score = 82.5, opportunity_tier = 'Tier 1'::opportunity_tier "
        "WHERE organization_id = %s",
        (str(org_id),),
    )
    conn.execute(
        "INSERT INTO qualification_results (organization_id, is_qualified) VALUES (%s, TRUE)",
        (str(org_id),),
    )
    conn.commit()


@pytest.mark.asyncio
async def test_full_pipeline_runs_and_is_idempotent(test_settings: Settings) -> None:
    domain = "e2etestbank.example"
    official_url = f"https://{domain}"

    with psycopg.connect(test_settings.database_url) as conn:
        org_id = _seed_organization(conn, domain=domain)
        _seed_icp_outcome(conn, org_id)

    fake_profile = make_fake_profile()
    fetcher = FakeFetcher({official_url: RICH_HTML}, content_type="text/html")
    extraction_engine = FakeExtractionEngine(fake_profile)
    icp_client = FakeBackendClient()

    result_1 = await run_for_organization(
        org_id, test_settings, fetcher=fetcher, extraction_engine=extraction_engine, icp_client=icp_client
    )

    assert result_1["status"] == "QUALIFIED"

    with psycopg.connect(test_settings.database_url) as conn:
        status = conn.execute("SELECT status FROM organizations WHERE organization_id = %s", (str(org_id),)).fetchone()
        assert status is not None
        assert OrgStatus(status[0]) == OrgStatus.QUALIFIED

        crawl_sources_count = conn.execute(
            "SELECT COUNT(*) FROM crawl_sources WHERE organization_id = %s", (str(org_id),)
        ).fetchone()[0]
        assert crawl_sources_count > 0

        documents_count_1 = conn.execute(
            "SELECT COUNT(*) FROM documents WHERE organization_id = %s", (str(org_id),)
        ).fetchone()[0]
        assert documents_count_1 > 0

        enrichment_jobs_count_1 = conn.execute(
            "SELECT COUNT(*) FROM enrichment_jobs WHERE organization_id = %s", (str(org_id),)
        ).fetchone()[0]
        assert enrichment_jobs_count_1 > 0

        financial_metrics_count_1 = conn.execute(
            "SELECT COUNT(*) FROM financial_metrics WHERE organization_id = %s", (str(org_id),)
        ).fetchone()[0]
        assert financial_metrics_count_1 == 1  # revenue, fiscal_year=2024, written once

        timeline_events_count_1 = conn.execute(
            "SELECT COUNT(*) FROM timeline_events WHERE organization_id = %s", (str(org_id),)
        ).fetchone()[0]

    # --- Second run: same organization, same content -- must not duplicate anything ---
    fetcher_2 = FakeFetcher({official_url: RICH_HTML}, content_type="text/html")
    extraction_engine_2 = FakeExtractionEngine(fake_profile)
    icp_client_2 = FakeBackendClient()

    result_2 = await run_for_organization(
        org_id, test_settings, fetcher=fetcher_2, extraction_engine=extraction_engine_2, icp_client=icp_client_2
    )
    assert result_2["status"] == "QUALIFIED"

    with psycopg.connect(test_settings.database_url) as conn:
        documents_count_2 = conn.execute(
            "SELECT COUNT(*) FROM documents WHERE organization_id = %s", (str(org_id),)
        ).fetchone()[0]
        assert documents_count_2 == documents_count_1, "unchanged content must not create duplicate documents"

        enrichment_jobs_count_2 = conn.execute(
            "SELECT COUNT(*) FROM enrichment_jobs WHERE organization_id = %s", (str(org_id),)
        ).fetchone()[0]
        assert enrichment_jobs_count_2 == enrichment_jobs_count_1, (
            "a document already PASSED at the current prompt_version must not be re-extracted"
        )

        financial_metrics_count_2 = conn.execute(
            "SELECT COUNT(*) FROM financial_metrics WHERE organization_id = %s", (str(org_id),)
        ).fetchone()[0]
        assert financial_metrics_count_2 == financial_metrics_count_1, "no duplicate metric row on re-run"

        crawl_sources_count_2 = conn.execute(
            "SELECT COUNT(*) FROM crawl_sources WHERE organization_id = %s", (str(org_id),)
        ).fetchone()[0]
        assert crawl_sources_count_2 == crawl_sources_count

        # Second run's extraction never actually re-ran (gated by prompt_version), so no new
        # diff was computed against itself -- timeline_events count is unchanged too.
        timeline_events_count_2 = conn.execute(
            "SELECT COUNT(*) FROM timeline_events WHERE organization_id = %s", (str(org_id),)
        ).fetchone()[0]
        assert timeline_events_count_2 == timeline_events_count_1

    # every populated financial_metrics row must cite a real source_document_id (traceability)
    with psycopg.connect(test_settings.database_url) as conn:
        untraced = conn.execute(
            "SELECT COUNT(*) FROM financial_metrics WHERE organization_id = %s AND source_document_id IS NULL",
            (str(org_id),),
        ).fetchone()[0]
        assert untraced == 0


@pytest.mark.asyncio
async def test_pipeline_handles_fetch_failure_gracefully(test_settings: Settings) -> None:
    domain = "e2efailbank.example"
    with psycopg.connect(test_settings.database_url) as conn:
        org_id = _seed_organization(conn, domain=domain)

    fetcher = FakeFetcher({}, fail_urls={f"https://{domain}"})
    extraction_engine = FakeExtractionEngine()
    icp_client = FakeBackendClient()

    result = await run_for_organization(
        org_id, test_settings, fetcher=fetcher, extraction_engine=extraction_engine, icp_client=icp_client
    )

    # Must not crash the run -- some other candidate URLs still succeed via the default fake response.
    assert result["status"] != "FAILED"

    with psycopg.connect(test_settings.database_url) as conn:
        failed_jobs = conn.execute(
            "SELECT COUNT(*) FROM crawl_jobs WHERE organization_id = %s AND status IN ('FAILED', 'RETRY')",
            (str(org_id),),
        ).fetchone()[0]
        assert failed_jobs > 0  # the deliberately-failing URL is recorded, not silently dropped
