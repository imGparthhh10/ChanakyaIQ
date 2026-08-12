"""Composes stages 1-9 for one organization, advancing organizations.status at each boundary
(this is how the dashboard shows live progress) and wrapping the whole run in one job_history
entry per rule 4. Any single stage's own DB writes are already self-contained/idempotent (see
each stage's repository module) -- this module's job is sequencing and status, not DML.

Each stage can also be run in isolation (see the `run_<stage>_only` functions at the bottom),
used by the CLI's `run-stage` command and by tests.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from pipeline.classification.engine import classify_for_organization
from pipeline.collection.engine import collect_for_organization
from pipeline.collection.fetcher import DocumentFetcher, HttpxFetcher
from pipeline.config import Settings
from pipeline.db.connection import get_connection
from pipeline.db.observability import finish_job_history, log_processing, record_error, start_job_history
from pipeline.db.org_status import set_org_status
from pipeline.db.organizations import load_organization_ref
from pipeline.discovery.engine import discover_sources
from pipeline.discovery.repository import save_candidates
from pipeline.enums import LogLevel, OrgStatus
from pipeline.extraction.engine import ExtractionEngine, get_extraction_engine
from pipeline.extraction.runner import extract_for_organization
from pipeline.icp.client import BackendClient
from pipeline.icp.engine import run_icp_handoff
from pipeline.net.http_client import PoliteHttpClient
from pipeline.processing.engine import process_for_organization
from pipeline.profile.engine import merge_profile
from pipeline.resolution.engine import resolve_for_document
from pipeline.timeline.engine import build_timeline_events

_WORKER_NAME = "PipelineOrchestrator"


class OrganizationNotFound(Exception):
    pass


async def run_for_organization(
    organization_id: UUID,
    settings: Settings,
    *,
    fetcher: DocumentFetcher | None = None,
    extraction_engine: ExtractionEngine | None = None,
    icp_client: BackendClient | None = None,
) -> dict[str, Any]:
    with get_connection(settings) as conn:
        org = load_organization_ref(conn, organization_id)
        if org is None:
            raise OrganizationNotFound(str(organization_id))
        job_history_id = start_job_history(conn, worker_name=_WORKER_NAME, organization_id=organization_id)

    try:
        result = await _run_stages(org.organization_id, org.legal_name, settings, fetcher=fetcher, extraction_engine=extraction_engine, icp_client=icp_client)
        with get_connection(settings) as conn:
            finish_job_history(conn, job_history_id, status="SUCCESS", details=result)
        return result
    except Exception as exc:  # noqa: BLE001 -- a full-run failure is recorded, never crashes the batch/CLI process
        with get_connection(settings) as conn:
            record_error(conn, organization_id=organization_id, worker_name=_WORKER_NAME, error_type=type(exc).__name__, exc=exc)
            set_org_status(conn, organization_id, OrgStatus.FAILED)
            finish_job_history(conn, job_history_id, status="FAILED", details={"error": str(exc)})
        return {"organization_id": str(organization_id), "status": "FAILED", "error": str(exc)}


async def _run_stages(
    organization_id: UUID, legal_name: str, settings: Settings, *,
    fetcher: DocumentFetcher | None, extraction_engine: ExtractionEngine | None, icp_client: BackendClient | None,
) -> dict[str, Any]:
    # --- Stage 1: Discovery ---
    with get_connection(settings) as conn:
        set_org_status(conn, organization_id, OrgStatus.DISCOVERING_SOURCES)
        org = load_organization_ref(conn, organization_id)
    assert org is not None
    discovery_result = await discover_sources(org, settings)
    with get_connection(settings) as conn:
        save_candidates(conn, discovery_result)

    # --- Stage 2: Collection ---
    with get_connection(settings) as conn:
        set_org_status(conn, organization_id, OrgStatus.CRAWLING)

    if fetcher is not None:
        collection_outcomes = await collect_for_organization(organization_id, fetcher, settings)
    else:
        async with PoliteHttpClient(
            user_agent=settings.user_agent,
            per_domain_min_interval_s=settings.per_domain_min_interval_s,
            per_domain_jitter_s=settings.per_domain_jitter_s,
            request_timeout_s=settings.request_timeout_s,
            max_retries=settings.max_fetch_retries,
            backoff_base_s=settings.backoff_base_s,
        ) as http_client:
            collection_outcomes = await collect_for_organization(organization_id, HttpxFetcher(http_client), settings)

    with get_connection(settings) as conn:
        set_org_status(conn, organization_id, OrgStatus.DOCUMENTS_COLLECTED)

    # --- Stage 3: Classification ---
    classify_for_organization(organization_id, settings)

    # --- Stage 4: Processing (OCR / language / translation / cleaning / chunking) ---
    processing_results = process_for_organization(organization_id, settings)
    with get_connection(settings) as conn:
        set_org_status(conn, organization_id, OrgStatus.OCR_COMPLETE)
        set_org_status(conn, organization_id, OrgStatus.TRANSLATED)

    # --- Stage 5: LLM Extraction ---
    with get_connection(settings) as conn:
        set_org_status(conn, organization_id, OrgStatus.EXTRACTING)
    extraction_results = await extract_for_organization(
        organization_id, legal_name, settings, engine=extraction_engine or get_extraction_engine(settings)
    )

    # --- Stages 6-8: Entity Resolution -> Timeline -> Profile Merge, per successfully-extracted document ---
    with get_connection(settings) as conn:
        set_org_status(conn, organization_id, OrgStatus.ENTITY_RESOLUTION)

    any_gated_low_confidence = False
    documents_merged = 0
    for extraction in extraction_results:
        if extraction.get("status") != "PASSED" or "profile" not in extraction:
            continue
        document_id = extraction["document_id"]
        enrichment_job_id = extraction["enrichment_job_id"]
        profile = extraction["profile"]

        resolve_for_document(organization_id, enrichment_job_id, profile, settings)
        build_timeline_events(organization_id, document_id, profile, settings)
        merge_summary = merge_profile(organization_id, document_id, profile, settings)
        if merge_summary.gated_low_confidence:
            any_gated_low_confidence = True
        else:
            documents_merged += 1

    if any_gated_low_confidence and documents_merged == 0:
        with get_connection(settings) as conn:
            set_org_status(conn, organization_id, OrgStatus.REVIEW_QUEUE)
            log_processing(
                conn, organization_id=organization_id, stage="ORCHESTRATOR",
                message="All extractions were below the confidence threshold -- organization "
                "routed to REVIEW_QUEUE instead of proceeding to ICP scoring.",
                level=LogLevel.WARN,
            )
        return {
            "organization_id": str(organization_id), "status": "REVIEW_QUEUE",
            "collection_outcomes": len(collection_outcomes), "processing_results": len(processing_results),
            "extraction_results": len(extraction_results),
        }

    with get_connection(settings) as conn:
        set_org_status(conn, organization_id, OrgStatus.ENRICHED)

    # --- Stage 9: ICP Match & Dashboard Handoff ---
    icp_result = await run_icp_handoff(organization_id, settings, client=icp_client)

    return {
        "organization_id": str(organization_id),
        "status": icp_result["final_status"].value if icp_result else "REVIEW_QUEUE",
        "collection_outcomes": len(collection_outcomes),
        "processing_results": len(processing_results),
        "extraction_results": len(extraction_results),
        "documents_merged": documents_merged,
        "icp": icp_result,
    }


# --- Single-stage entry points (CLI `run-stage`, and tests) ---

async def run_discovery_only(organization_id: UUID, settings: Settings) -> dict[str, Any]:
    with get_connection(settings) as conn:
        org = load_organization_ref(conn, organization_id)
        if org is None:
            raise OrganizationNotFound(str(organization_id))
    result = await discover_sources(org, settings)
    with get_connection(settings) as conn:
        inserted = save_candidates(conn, result)
    return {"candidates": len(result.candidates), "inserted": inserted}


async def run_collection_only(organization_id: UUID, settings: Settings, *, fetcher: DocumentFetcher | None = None) -> dict[str, Any]:
    if fetcher is not None:
        outcomes = await collect_for_organization(organization_id, fetcher, settings)
    else:
        async with PoliteHttpClient(
            user_agent=settings.user_agent, per_domain_min_interval_s=settings.per_domain_min_interval_s,
            per_domain_jitter_s=settings.per_domain_jitter_s, request_timeout_s=settings.request_timeout_s,
            max_retries=settings.max_fetch_retries, backoff_base_s=settings.backoff_base_s,
        ) as http_client:
            outcomes = await collect_for_organization(organization_id, HttpxFetcher(http_client), settings)
    return {"outcomes": len(outcomes), "succeeded": sum(1 for o in outcomes if o.succeeded)}


def run_classification_only(organization_id: UUID, settings: Settings) -> dict[str, Any]:
    results = classify_for_organization(organization_id, settings)
    return {"classified": len(results), "applied": sum(1 for r in results if r.applied)}


def run_processing_only(organization_id: UUID, settings: Settings) -> dict[str, Any]:
    results = process_for_organization(organization_id, settings)
    return {"processed": len(results), "passed": sum(1 for r in results if r.passed_quality_check)}


async def run_extraction_only(organization_id: UUID, settings: Settings, *, engine: ExtractionEngine | None = None) -> dict[str, Any]:
    with get_connection(settings) as conn:
        org = load_organization_ref(conn, organization_id)
        if org is None:
            raise OrganizationNotFound(str(organization_id))
    results = await extract_for_organization(organization_id, org.legal_name, settings, engine=engine)
    return {"extracted": len(results), "passed": sum(1 for r in results if r.get("status") == "PASSED")}


async def run_icp_only(organization_id: UUID, settings: Settings, *, client: BackendClient | None = None) -> dict[str, Any] | None:
    return await run_icp_handoff(organization_id, settings, client=client)
