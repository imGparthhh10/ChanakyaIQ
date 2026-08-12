"""organizations.status transitions — the single place this column is ever written from Python,
so every stage advances it the same way. This is how the live dashboard shows pipeline progress
(rule: "Advance organizations.status through these as each stage completes").
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from psycopg import Connection

from pipeline.enums import OrgStatus


def set_org_status(conn: Connection, organization_id: uuid.UUID | str, status: OrgStatus) -> None:
    conn.execute(
        "UPDATE organizations SET status = %s::org_status, updated_at = %s WHERE organization_id = %s",
        (str(status), datetime.now(UTC), str(organization_id)),
    )


def get_org_status(conn: Connection, organization_id: uuid.UUID | str) -> OrgStatus | None:
    row = conn.execute(
        "SELECT status FROM organizations WHERE organization_id = %s", (str(organization_id),)
    ).fetchone()
    if row is None:
        return None
    return OrgStatus(row[0])
