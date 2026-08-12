from __future__ import annotations

from typing import Any
from uuid import UUID

from psycopg import Connection
from psycopg.rows import dict_row

from pipeline.resolution.schema import EntityCandidate


def save_extracted_entity(conn: Connection, enrichment_job_id: UUID, candidate: EntityCandidate) -> UUID:
    row = conn.execute(
        "INSERT INTO extracted_entities (enrichment_job_id, entity_type, entity_value, normalized_value, confidence) "
        "VALUES (%s, %s, %s, %s, %s) RETURNING entity_id",
        (str(enrichment_job_id), candidate.entity_type, candidate.entity_value, candidate.normalized_value, candidate.confidence),
    ).fetchone()
    assert row is not None
    return UUID(str(row[0]))


def find_alias_match(conn: Connection, normalized_name: str) -> UUID | None:
    """Exact match against organization_aliases -- the highest-confidence resolution path,
    checked before falling back to trigram fuzzy matching."""
    row = conn.execute(
        "SELECT organization_id FROM organization_aliases WHERE lower(alias_name) = %s LIMIT 1",
        (normalized_name,),
    ).fetchone()
    return UUID(str(row[0])) if row else None


def find_trigram_match(conn: Connection, company_name: str, *, similarity_threshold: float) -> tuple[UUID, float] | None:
    """Fuzzy candidate lookup using the DB's own trigram index on organizations.legal_name
    (idx_org_name_trgm) -- exactly the index the spec points to, via pg_trgm's similarity()."""
    row = conn.execute(
        "SELECT organization_id, similarity(legal_name, %s) AS sim FROM organizations "
        "WHERE legal_name %% %s ORDER BY sim DESC LIMIT 1",
        (company_name, company_name),
    ).fetchone()
    if row is None:
        return None
    org_id, sim = row
    if sim < similarity_threshold:
        return None
    return UUID(str(org_id)), float(sim)


def save_entity_resolution(
    conn: Connection, entity_id: UUID, resolved_organization_id: UUID | None, resolution_method: str
) -> None:
    conn.execute(
        "INSERT INTO entity_resolutions (entity_id, resolved_organization_id, resolution_method) "
        "VALUES (%s, %s, %s)",
        (str(entity_id), str(resolved_organization_id) if resolved_organization_id else None, resolution_method),
    )


def load_llm_profile(conn: Connection, enrichment_job_id: UUID) -> dict[str, Any] | None:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT profile_json FROM llm_profiles WHERE enrichment_job_id = %s LIMIT 1",
            (str(enrichment_job_id),),
        )
        row = cur.fetchone()
        return row["profile_json"] if row else None
