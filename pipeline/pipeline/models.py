"""Shared pydantic types used across more than one stage. Stage-specific contracts (discovery
candidates, extracted profiles, timeline events, ...) live in their own stage's `schema.py` /
`models.py` next to the code that produces and consumes them.
"""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel


class OrganizationRef(BaseModel):
    """The minimal identity every stage needs to look an organization up and act on it —
    exactly the columns Stage 1 (discovery) reads to seed candidate URLs."""

    organization_id: UUID
    legal_name: str
    display_name: str | None = None
    domain: str | None = None
    cin_number: str | None = None
    sector_id: int | None = None


class SourceCitation(BaseModel):
    """Every extracted field must be traceable to where it came from (acceptance criterion:
    'Every populated field is traceable to a source document') — this is that pointer."""

    document_id: UUID
    chunk_index: int | None = None
