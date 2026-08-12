"""Turns a validated ExtractedProfile (stage 5's output) into EntityCandidates -- pure, no I/O.

Scope (judgment call, see pipeline/README.md): only fields that map cleanly onto the spec's
requested entity categories (people, locations, technologies, products, vendors, cloud
providers) go through entity resolution. Narrative list fields without a clean entity category
(awards, certifications, hiring_signals, digital_initiatives, company_summary) are persisted
directly in stage 8 (profile merge) instead -- they aren't "entities" to resolve against
canonical organizations, they're descriptive facts about this one organization.
"""

from __future__ import annotations

from pipeline.extraction.schema import ExtractedProfile, SourcedListItem, SourcedValue
from pipeline.resolution.normalize import (
    detect_cloud_providers,
    normalize_company_name,
    normalize_generic,
    normalize_person_name,
)
from pipeline.resolution.schema import EntityCandidate


def _from_scalar(value: SourcedValue | None, entity_type: str, normalize) -> list[EntityCandidate]:  # type: ignore[no-untyped-def]
    if value is None or value.value is None or not str(value.value).strip():
        return []
    text = str(value.value)
    return [
        EntityCandidate(
            entity_type=entity_type, entity_value=text, normalized_value=normalize(text),
            confidence=value.confidence, source_chunk_index=value.source_chunk_index,
        )
    ]


def _from_list(items: list[SourcedListItem], entity_type: str, normalize) -> list[EntityCandidate]:  # type: ignore[no-untyped-def]
    return [
        EntityCandidate(
            entity_type=entity_type, entity_value=item.value, normalized_value=normalize(item.value),
            confidence=item.confidence, source_chunk_index=item.source_chunk_index,
        )
        for item in items
        if item.value.strip()
    ]


def _cloud_provider_candidates(items: list[SourcedListItem]) -> list[EntityCandidate]:
    out: list[EntityCandidate] = []
    for item in items:
        for provider in detect_cloud_providers(item.value):
            out.append(
                EntityCandidate(
                    entity_type="CLOUD_PROVIDER", entity_value=provider, normalized_value=provider.lower(),
                    confidence=item.confidence, source_chunk_index=item.source_chunk_index,
                )
            )
    return out


def extract_candidates(profile: ExtractedProfile) -> list[EntityCandidate]:
    out: list[EntityCandidate] = []
    for field in (profile.ceo_name, profile.cio_name, profile.cto_name, profile.ciso_name, profile.chairman_name):
        out.extend(_from_scalar(field, "PERSON", normalize_person_name))
    out.extend(_from_list(profile.board_members, "PERSON", normalize_person_name))
    out.extend(_from_scalar(profile.headquarters, "LOCATION", normalize_generic))
    out.extend(_from_list(profile.technology_stack, "TECHNOLOGY", normalize_generic))
    out.extend(_from_list(profile.ai_projects, "TECHNOLOGY", normalize_generic))
    out.extend(_from_list(profile.cloud_projects, "TECHNOLOGY", normalize_generic))
    out.extend(_from_list(profile.products, "PRODUCT", normalize_generic))
    out.extend(_from_list(profile.services, "PRODUCT", normalize_generic))
    out.extend(_from_list(profile.partnerships, "VENDOR", normalize_company_name))
    out.extend(_cloud_provider_candidates(profile.technology_stack))
    out.extend(_cloud_provider_candidates(profile.cloud_projects))
    return out
