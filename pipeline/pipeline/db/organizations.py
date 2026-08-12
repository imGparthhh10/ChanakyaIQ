"""The one place organizations is read from outside a specific stage's own repository --
shared by the orchestrator (to seed a run) and the CLI (to list runnable orgs)."""

from __future__ import annotations

from uuid import UUID

from psycopg import Connection
from psycopg.rows import dict_row

from pipeline.enums import OrgStatus
from pipeline.models import OrganizationRef


def load_organization_ref(conn: Connection, organization_id: UUID) -> OrganizationRef | None:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT organization_id, legal_name, display_name, domain, cin_number, sector_id "
            "FROM organizations WHERE organization_id = %s",
            (str(organization_id),),
        )
        row = cur.fetchone()
        return OrganizationRef(**row) if row else None


def list_organization_ids_by_status(conn: Connection, status: OrgStatus, *, limit: int = 500) -> list[UUID]:
    rows = conn.execute(
        "SELECT organization_id FROM organizations WHERE status = %s ORDER BY created_at LIMIT %s",
        (str(status), limit),
    ).fetchall()
    return [UUID(str(r[0])) for r in rows]
