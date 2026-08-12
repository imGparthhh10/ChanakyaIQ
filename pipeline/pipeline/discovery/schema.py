from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field

from pipeline.enums import DocumentType


class SourceCandidate(BaseModel):
    """One candidate document URL, scored, before it's written to crawl_sources. `confidence`
    is in [0, 1]. `discovery_method` explains how it was found — required, per the spec
    ("record how it was found"), never blank."""

    organization_id: UUID
    url: str
    source_type: DocumentType
    confidence: float = Field(ge=0.0, le=1.0)
    discovery_method: str


class DiscoveryResult(BaseModel):
    organization_id: UUID
    candidates: list[SourceCandidate]
    total_generated: int
    total_after_filter: int
