"""Read-back only -- runIcpScoring() on the Node side already wrote organizations.icp_score/
opportunity_tier, qualification_results, score_history, tier_history, and organization_tags for
every organization in one global run. This just fetches this one org's resulting row."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from psycopg import Connection


def get_icp_outcome(conn: Connection, organization_id: UUID) -> dict[str, Any] | None:
    org_row = conn.execute(
        "SELECT icp_score, opportunity_tier FROM organizations WHERE organization_id = %s",
        (str(organization_id),),
    ).fetchone()
    if org_row is None:
        return None

    qual_row = conn.execute(
        "SELECT is_qualified FROM qualification_results WHERE organization_id = %s "
        "ORDER BY evaluated_at DESC LIMIT 1",
        (str(organization_id),),
    ).fetchone()

    tag_rows = conn.execute(
        "SELECT ot.tag_name FROM organization_tags t JOIN opportunity_tags ot ON ot.tag_id = t.tag_id "
        "WHERE t.organization_id = %s",
        (str(organization_id),),
    ).fetchall()

    return {
        "icp_score": float(org_row[0]) if org_row[0] is not None else None,
        "opportunity_tier": org_row[1],
        "is_qualified": bool(qual_row[0]) if qual_row else None,
        "tags": [r[0] for r in tag_rows],
    }
