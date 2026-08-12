"""Reads the organization's *current* stored state (before stage 8 overwrites it) and writes
the resulting timeline_events. technology_profiles.category is a free-text column (not a DB
enum) -- this pipeline uses it as a bucket key ('technology_stack' / 'ai_projects' /
'cloud_project' / 'cloud_provider') matching the ExtractedProfile field names, so stage 8's
write-back and stage 7's read-back agree on the same vocabulary.
"""

from __future__ import annotations

from uuid import UUID

from psycopg import Connection

from pipeline.timeline.schema import PriorState

TECH_CATEGORY_STACK = "technology_stack"
TECH_CATEGORY_AI = "ai_projects"
TECH_CATEGORY_CLOUD_PROJECT = "cloud_project"
TECH_CATEGORY_CLOUD_PROVIDER = "cloud_provider"


def load_prior_state(conn: Connection, organization_id: UUID) -> PriorState:
    ceo_row = conn.execute(
        "SELECT ceo_name FROM leadership_profiles WHERE organization_id = %s", (str(organization_id),)
    ).fetchone()

    revenue_row = conn.execute(
        "SELECT fm.value FROM financial_metrics fm JOIN metric_definitions md ON md.metric_id = fm.metric_id "
        "WHERE fm.organization_id = %s AND md.metric_key = 'revenue' "
        "ORDER BY fm.fiscal_year DESC NULLS LAST, fm.extracted_at DESC LIMIT 1",
        (str(organization_id),),
    ).fetchone()

    branch_row = conn.execute(
        "SELECT COUNT(*) FROM branches WHERE organization_id = %s", (str(organization_id),)
    ).fetchone()

    profile_row = conn.execute(
        "SELECT partnerships, awards FROM organization_profiles WHERE organization_id = %s",
        (str(organization_id),),
    ).fetchone()

    tech_rows = conn.execute(
        "SELECT category, value_text FROM technology_profiles WHERE organization_id = %s "
        "AND category = ANY(%s)",
        (str(organization_id), [TECH_CATEGORY_STACK, TECH_CATEGORY_AI, TECH_CATEGORY_CLOUD_PROJECT, TECH_CATEGORY_CLOUD_PROVIDER]),
    ).fetchall()

    by_category: dict[str, set[str]] = {}
    for category, value_text in tech_rows:
        by_category.setdefault(category, set()).add(value_text)

    return PriorState(
        ceo_name=ceo_row[0] if ceo_row else None,
        latest_revenue_inr_cr=float(revenue_row[0]) if revenue_row and revenue_row[0] is not None else None,
        branch_count=int(branch_row[0]) if branch_row else None,
        technology_stack=by_category.get(TECH_CATEGORY_STACK, set()),
        ai_projects=by_category.get(TECH_CATEGORY_AI, set()),
        cloud_projects=by_category.get(TECH_CATEGORY_CLOUD_PROJECT, set()),
        cloud_providers=by_category.get(TECH_CATEGORY_CLOUD_PROVIDER, set()),
        partnerships=set(profile_row[0]) if profile_row and profile_row[0] else set(),
        awards=set(profile_row[1]) if profile_row and profile_row[1] else set(),
    )


def save_timeline_event(
    conn: Connection,
    organization_id: UUID,
    *,
    event_type: str,
    event_summary: str,
    old_value: object,
    new_value: object,
    source_document_id: UUID | None,
    confidence: float,
) -> UUID:
    import json
    from datetime import date

    row = conn.execute(
        "INSERT INTO timeline_events (organization_id, event_type, event_summary, event_date, "
        "old_value, new_value, source_document_id, confidence) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING event_id",
        (
            str(organization_id), event_type, event_summary, date.today(),
            json.dumps(old_value, default=str) if old_value is not None else None,
            json.dumps(new_value, default=str) if new_value is not None else None,
            str(source_document_id) if source_document_id else None, confidence,
        ),
    ).fetchone()
    assert row is not None
    return UUID(str(row[0]))
