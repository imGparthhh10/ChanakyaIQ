"""Stage 7 entry point. Must run before stage 8 overwrites the organization's stored profile --
diffing happens against what's *currently* in organization_profiles/leadership_profiles/
financial_metrics/technology_profiles/branches, not the new extraction against itself.
"""

from __future__ import annotations

from uuid import UUID

from pipeline.config import Settings
from pipeline.db.connection import get_connection
from pipeline.db.observability import log_processing
from pipeline.enums import LogLevel
from pipeline.extraction.schema import ExtractedProfile
from pipeline.timeline.diff import diff_profile
from pipeline.timeline.repository import load_prior_state, save_timeline_event


def build_timeline_events(
    organization_id: UUID, document_id: UUID, profile: ExtractedProfile, settings: Settings
) -> int:
    with get_connection(settings) as conn:
        prior = load_prior_state(conn, organization_id)
        drafts = diff_profile(prior, profile, settings)

        for draft in drafts:
            save_timeline_event(
                conn, organization_id,
                event_type=draft.event_type, event_summary=draft.event_summary,
                old_value=draft.old_value, new_value=draft.new_value,
                source_document_id=document_id, confidence=draft.confidence,
            )

        log_processing(
            conn, organization_id=organization_id, stage="TIMELINE",
            message=f"{len(drafts)} material change(s) detected from document {document_id}."
            if drafts else f"No material changes detected from document {document_id}.",
            level=LogLevel.INFO,
        )
    return len(drafts)
