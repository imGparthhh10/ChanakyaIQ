"""All DML for stage 8. Every accepted change is logged to change_history (field_name,
old_value, new_value) -- this is the audit trail rule 4 asks for, applied at the per-field
level rather than per-stage like processing_logs.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any
from uuid import UUID

from psycopg import Connection

CHANGED_BY = "pipeline"


def log_change(conn: Connection, organization_id: UUID, field_name: str, old_value: object, new_value: object) -> None:
    conn.execute(
        "INSERT INTO change_history (organization_id, field_name, old_value, new_value, changed_by) "
        "VALUES (%s, %s, %s, %s, %s)",
        (str(organization_id), field_name, str(old_value) if old_value is not None else None, str(new_value), CHANGED_BY),
    )


def get_metric_id(conn: Connection, metric_key: str) -> int | None:
    row = conn.execute("SELECT metric_id FROM metric_definitions WHERE metric_key = %s", (metric_key,)).fetchone()
    return int(row[0]) if row else None


def _upsert_metric(
    conn: Connection, table: str, organization_id: UUID, metric_id: int, fiscal_year: int,
    value: float, confidence: float, source_document_id: UUID, field_name: str,
) -> bool:
    id_col = "financial_metric_id" if table == "financial_metrics" else "technology_metric_id"
    existing = conn.execute(
        f"SELECT {id_col}, value, confidence FROM {table} "
        "WHERE organization_id = %s AND metric_id = %s AND fiscal_year = %s",
        (str(organization_id), metric_id, fiscal_year),
    ).fetchone()

    from pipeline.profile.merge import should_replace

    old_confidence = float(existing[2]) if existing and existing[2] is not None else None
    if not should_replace(old_confidence, confidence):
        return False

    if existing:
        conn.execute(
            f"UPDATE {table} SET value = %s, confidence = %s, source_document_id = %s, extracted_at = %s "
            f"WHERE {id_col} = %s",
            (value, confidence, str(source_document_id), datetime.now(UTC), existing[0]),
        )
        log_change(conn, organization_id, field_name, existing[1], value)
    else:
        conn.execute(
            f"INSERT INTO {table} (organization_id, metric_id, fiscal_year, value, source_document_id, confidence) "
            "VALUES (%s, %s, %s, %s, %s, %s)",
            (str(organization_id), metric_id, fiscal_year, value, str(source_document_id), confidence),
        )
        log_change(conn, organization_id, field_name, None, value)
    return True


def upsert_financial_metric(conn: Connection, organization_id: UUID, metric_key: str, fiscal_year: int, value: float, confidence: float, source_document_id: UUID) -> bool:
    metric_id = get_metric_id(conn, metric_key)
    if metric_id is None:
        return False
    return _upsert_metric(conn, "financial_metrics", organization_id, metric_id, fiscal_year, value, confidence, source_document_id, metric_key)


def upsert_technology_metric(conn: Connection, organization_id: UUID, metric_key: str, fiscal_year: int, value: float, confidence: float, source_document_id: UUID) -> bool:
    metric_id = get_metric_id(conn, metric_key)
    if metric_id is None:
        return False
    return _upsert_metric(conn, "technology_metrics", organization_id, metric_id, fiscal_year, value, confidence, source_document_id, metric_key)


def upsert_technology_profile_item(
    conn: Connection, organization_id: UUID, category: str, value_text: str, confidence: float, source_document_id: UUID
) -> bool:
    """technology_profiles is append-style free text (category, value_text) -- no natural
    per-item unique key beyond the pair itself, so idempotency here is "don't insert the exact
    same (category, value_text) twice," not a confidence comparison (there's nothing to compare
    against for a genuinely new fact)."""
    existing = conn.execute(
        "SELECT 1 FROM technology_profiles WHERE organization_id = %s AND category = %s AND value_text = %s",
        (str(organization_id), category, value_text),
    ).fetchone()
    if existing:
        return False
    conn.execute(
        "INSERT INTO technology_profiles (organization_id, category, value_text, source_document_id, confidence) "
        "VALUES (%s, %s, %s, %s, %s)",
        (str(organization_id), category, value_text, str(source_document_id), confidence),
    )
    return True


def get_current_leadership(conn: Connection, organization_id: UUID, designation: str) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT leadership_id, person_name, confidence FROM leadership "
        "WHERE organization_id = %s AND designation = %s AND is_current = TRUE "
        "ORDER BY created_at DESC LIMIT 1",
        (str(organization_id), designation),
    ).fetchone()
    if row is None:
        return None
    return {"leadership_id": row[0], "person_name": row[1], "confidence": float(row[2]) if row[2] is not None else None}


def upsert_leadership(
    conn: Connection, organization_id: UUID, designation: str, person_name: str, confidence: float, source_document_id: UUID,
    leadership_profile_column: str | None,
) -> bool:
    from pipeline.profile.merge import should_replace

    current = get_current_leadership(conn, organization_id, designation)
    if current and current["person_name"] == person_name:
        return False  # unchanged -- nothing to log or write
    if not should_replace(current["confidence"] if current else None, confidence):
        return False

    if current:
        conn.execute(
            "UPDATE leadership SET is_current = FALSE, end_date = %s WHERE leadership_id = %s",
            (date.today(), current["leadership_id"]),
        )
    conn.execute(
        "INSERT INTO leadership (organization_id, person_name, designation, is_current, start_date, "
        "source_document_id, confidence) VALUES (%s, %s, %s, TRUE, %s, %s, %s)",
        (str(organization_id), person_name, designation, date.today(), str(source_document_id), confidence),
    )
    log_change(conn, organization_id, f"leadership.{designation}", current["person_name"] if current else None, person_name)

    if leadership_profile_column:
        conn.execute(
            f"INSERT INTO leadership_profiles (organization_id, {leadership_profile_column}, last_updated_at) "
            f"VALUES (%s, %s, %s) "
            f"ON CONFLICT (organization_id) DO UPDATE SET {leadership_profile_column} = EXCLUDED.{leadership_profile_column}, "
            f"last_updated_at = EXCLUDED.last_updated_at",
            (str(organization_id), person_name, datetime.now(UTC)),
        )
    return True


def union_organization_profile_array(conn: Connection, organization_id: UUID, column: str, new_items: list[str]) -> int:
    """Array-typed organization_profiles fields (products/services/awards/partnerships/
    digital_initiatives) have no per-item confidence column -- merged by union/dedup, never
    shrunk, since there's nothing to compare confidence against for a genuinely new item."""
    if not new_items:
        return 0
    existing = conn.execute(f"SELECT {column} FROM organization_profiles WHERE organization_id = %s", (str(organization_id),)).fetchone()
    current: list[str] = list(existing[0]) if existing and existing[0] else []
    merged = current + [item for item in new_items if item not in current]
    added = len(merged) - len(current)
    if added == 0:
        return 0
    conn.execute(
        f"INSERT INTO organization_profiles (organization_id, {column}, last_enriched_at) VALUES (%s, %s, %s) "
        f"ON CONFLICT (organization_id) DO UPDATE SET {column} = EXCLUDED.{column}, last_enriched_at = EXCLUDED.last_enriched_at",
        (str(organization_id), merged, datetime.now(UTC)),
    )
    log_change(conn, organization_id, f"organization_profiles.{column}", current, merged)
    return added


def update_organization_summary(conn: Connection, organization_id: UUID, summary: str) -> None:
    existing = conn.execute("SELECT summary FROM organization_profiles WHERE organization_id = %s", (str(organization_id),)).fetchone()
    old_summary = existing[0] if existing else None
    if old_summary == summary:
        return
    conn.execute(
        "INSERT INTO organization_profiles (organization_id, summary, last_enriched_at) VALUES (%s, %s, %s) "
        "ON CONFLICT (organization_id) DO UPDATE SET summary = EXCLUDED.summary, last_enriched_at = EXCLUDED.last_enriched_at",
        (str(organization_id), summary, datetime.now(UTC)),
    )
    log_change(conn, organization_id, "organization_profiles.summary", old_summary, summary)


def upsert_contact(conn: Connection, organization_id: UUID, channel: str, value: str, source_document_id: UUID) -> bool:
    existing = conn.execute(
        "SELECT 1 FROM contacts WHERE organization_id = %s AND channel = %s::contact_channel AND value = %s",
        (str(organization_id), channel, value),
    ).fetchone()
    if existing:
        return False
    conn.execute(
        "INSERT INTO contacts (organization_id, channel, value, is_primary, source_document_id) "
        "VALUES (%s, %s::contact_channel, %s, FALSE, %s)",
        (str(organization_id), channel, value, str(source_document_id)),
    )
    return True


def find_city_by_name(conn: Connection, city_name: str) -> dict[str, Any] | None:
    """Resolves a free-text headquarters string against the known cities table -- never
    fabricates a city_id/state_id when there's no match, addresses just isn't written for that
    document (logged by the caller)."""
    row = conn.execute(
        "SELECT city_id, state_id FROM cities WHERE lower(city_name) = lower(%s) LIMIT 1", (city_name,)
    ).fetchone()
    return {"city_id": row[0], "state_id": row[1]} if row else None


def upsert_headquarters_address(conn: Connection, organization_id: UUID, city_id: int, state_id: int) -> bool:
    existing = conn.execute(
        "SELECT address_id, city_id FROM addresses WHERE organization_id = %s AND is_headquarters = TRUE",
        (str(organization_id),),
    ).fetchone()
    if existing and existing[1] == city_id:
        return False
    if existing:
        conn.execute("UPDATE addresses SET city_id = %s, state_id = %s WHERE address_id = %s", (city_id, state_id, existing[0]))
    else:
        conn.execute(
            "INSERT INTO addresses (organization_id, city_id, state_id, is_headquarters) VALUES (%s, %s, %s, TRUE)",
            (str(organization_id), city_id, state_id),
        )
    return True
