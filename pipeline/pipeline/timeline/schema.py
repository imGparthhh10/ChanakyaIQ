from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class TimelineEventDraft(BaseModel):
    event_type: str
    event_summary: str
    old_value: Any = None
    new_value: Any = None
    confidence: float
    source_chunk_index: int | None = None


class PriorState(BaseModel):
    """What we already know about this organization before merging in the new extraction --
    read once per document, diffed against the new profile."""

    ceo_name: str | None = None
    latest_revenue_inr_cr: float | None = None
    branch_count: int | None = None
    technology_stack: set[str] = set()
    ai_projects: set[str] = set()
    cloud_projects: set[str] = set()
    cloud_providers: set[str] = set()
    partnerships: set[str] = set()
    awards: set[str] = set()
