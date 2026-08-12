from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel


class EntityCandidate(BaseModel):
    entity_type: str  # PERSON | LOCATION | TECHNOLOGY | PRODUCT | VENDOR | CLOUD_PROVIDER
    entity_value: str
    normalized_value: str
    confidence: float
    source_chunk_index: int | None = None


class ResolvedEntity(BaseModel):
    entity_id: UUID
    entity_type: str
    entity_value: str
    resolved_organization_id: UUID | None
    resolution_method: str | None
