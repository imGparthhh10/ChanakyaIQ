"""Stage 6 entry point: persist every extracted entity, then attempt organization resolution
for the ones that represent company mentions (VENDOR / CLOUD_PROVIDER candidates) -- alias
table first (exact, highest confidence), trigram fuzzy match against organizations.legal_name
second, otherwise left unresolved (resolved_organization_id NULL, resolution_method
'unresolved') rather than guessing.
"""

from __future__ import annotations

from uuid import UUID

from pipeline.config import Settings
from pipeline.db.connection import get_connection
from pipeline.db.observability import log_processing
from pipeline.enums import LogLevel
from pipeline.extraction.schema import ExtractedProfile
from pipeline.resolution.extract_candidates import extract_candidates
from pipeline.resolution.normalize import normalize_company_name
from pipeline.resolution.repository import (
    find_alias_match,
    find_trigram_match,
    save_entity_resolution,
    save_extracted_entity,
)
from pipeline.resolution.schema import ResolvedEntity

_RESOLVABLE_TYPES = {"VENDOR", "CLOUD_PROVIDER"}


def resolve_for_document(
    organization_id: UUID, enrichment_job_id: UUID, profile: ExtractedProfile, settings: Settings
) -> list[ResolvedEntity]:
    candidates = extract_candidates(profile)
    results: list[ResolvedEntity] = []

    with get_connection(settings) as conn:
        for candidate in candidates:
            entity_id = save_extracted_entity(conn, enrichment_job_id, candidate)
            resolved_org_id: UUID | None = None
            method: str | None = None

            if candidate.entity_type in _RESOLVABLE_TYPES:
                alias_hit = find_alias_match(conn, candidate.normalized_value)
                if alias_hit:
                    resolved_org_id, method = alias_hit, "exact_alias_match"
                else:
                    trigram_hit = find_trigram_match(
                        conn, normalize_company_name(candidate.entity_value),
                        similarity_threshold=settings.resolution_fuzzy_similarity_threshold,
                    )
                    if trigram_hit:
                        resolved_org_id, method = trigram_hit[0], f"trigram_fuzzy_match(similarity={trigram_hit[1]:.2f})"
                    else:
                        method = "unresolved"
                save_entity_resolution(conn, entity_id, resolved_org_id, method)

            results.append(
                ResolvedEntity(
                    entity_id=entity_id, entity_type=candidate.entity_type, entity_value=candidate.entity_value,
                    resolved_organization_id=resolved_org_id, resolution_method=method,
                )
            )

        log_processing(
            conn, organization_id=organization_id, stage="ENTITY_RESOLUTION",
            message=f"{len(candidates)} entities extracted; "
            f"{sum(1 for r in results if r.resolved_organization_id)} resolved to a canonical organization.",
            level=LogLevel.INFO,
        )

    return results
