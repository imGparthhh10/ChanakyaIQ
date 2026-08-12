"""Stage 5 entry point -- ties the ExtractionEngine (LLM backend) to enrichment_jobs /
llm_profiles persistence. One enrichment_job per document (each processed document gets its
own extraction call, its own citations stay internally consistent to that document's chunks).
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from pipeline.config import Settings
from pipeline.db.connection import get_connection
from pipeline.db.observability import log_processing, record_error
from pipeline.enums import ExtractionStatus, LogLevel
from pipeline.extraction.engine import (
    PROMPT_VERSION,
    ExtractionEngine,
    ExtractionValidationFailed,
    get_extraction_engine,
)
from pipeline.extraction.repository import (
    create_enrichment_job,
    finish_enrichment_job,
    load_processed_documents_with_chunks,
    save_llm_profile,
)

_WORKER_NAME = "ExtractionWorker"


async def extract_for_organization(
    organization_id: UUID, organization_name: str, settings: Settings, *, engine: ExtractionEngine | None = None
) -> list[dict[str, Any]]:
    engine = engine or get_extraction_engine(settings)
    is_stub = engine.__class__.__name__ == "StubExtractionEngine"

    with get_connection(settings) as conn:
        documents = load_processed_documents_with_chunks(
            conn, organization_id, max_chunks_per_document=settings.llm_max_chunks_per_document,
            prompt_version=PROMPT_VERSION,
        )
        if not documents:
            log_processing(
                conn, organization_id=organization_id, stage="EXTRACTION",
                message="No PROCESSED documents pending extraction (either none exist yet, or "
                "all already have a PASSED extraction at this prompt version).",
                level=LogLevel.INFO,
            )
            return []
        if is_stub:
            log_processing(
                conn, organization_id=organization_id, stage="EXTRACTION",
                message="ANTHROPIC_API_KEY not configured -- using StubExtractionEngine. "
                "Every enrichment_job below will be marked MANUAL_REVIEW with an empty profile, "
                "nothing fabricated.",
                level=LogLevel.WARN,
            )

    results = []
    for doc in documents:
        result = await _extract_one_document(
            organization_id, organization_name, doc, engine, settings,
        )
        results.append(result)
    return results


async def _extract_one_document(
    organization_id: UUID, organization_name: str, doc: dict[str, Any], engine: ExtractionEngine, settings: Settings
) -> dict[str, Any]:
    with get_connection(settings) as conn:
        job_id = create_enrichment_job(conn, organization_id, doc["document_id"])

    chunks = [(c["chunk_index"], c["chunk_text"]) for c in doc["chunks"]]
    try:
        result = await engine.extract(organization_name=organization_name, chunks=chunks)
    except ExtractionValidationFailed as exc:
        with get_connection(settings) as conn:
            finish_enrichment_job(
                conn, job_id, status=ExtractionStatus.MANUAL_REVIEW,
                llm_model=settings.llm_model, prompt_version=PROMPT_VERSION, error_message=str(exc),
            )
            log_processing(
                conn, organization_id=organization_id, stage="EXTRACTION",
                message=f"Document {doc['document_id']}: validation failed after retries, routed to manual review.",
                level=LogLevel.WARN,
            )
        return {"document_id": doc["document_id"], "enrichment_job_id": job_id, "status": "MANUAL_REVIEW"}
    except Exception as exc:  # noqa: BLE001 -- any other failure is persisted, never crashes the run
        with get_connection(settings) as conn:
            record_error(conn, organization_id=organization_id, worker_name=_WORKER_NAME, error_type=type(exc).__name__, exc=exc)
            finish_enrichment_job(conn, job_id, status=ExtractionStatus.FAILED, error_message=str(exc))
        return {"document_id": doc["document_id"], "enrichment_job_id": job_id, "status": "FAILED"}

    is_stub = result.model_name == "stub"
    status = ExtractionStatus.MANUAL_REVIEW if is_stub else ExtractionStatus.PASSED

    with get_connection(settings) as conn:
        save_llm_profile(conn, job_id, organization_id, result.profile.model_dump(mode="json"))
        finish_enrichment_job(
            conn, job_id, status=status, llm_model=result.model_name, prompt_version=PROMPT_VERSION,
            raw_response=result.raw_response, confidence_score=result.profile.overall_confidence,
        )
        log_processing(
            conn, organization_id=organization_id, stage="EXTRACTION",
            message=f"Document {doc['document_id']}: extracted with confidence "
            f"{result.profile.overall_confidence:.1f} ({result.model_name}).",
            level=LogLevel.INFO,
        )

    return {
        "document_id": doc["document_id"], "enrichment_job_id": job_id, "status": str(status),
        "profile": result.profile,
    }
