from __future__ import annotations

from typing import Any
from uuid import UUID

from pipeline.config import Settings
from pipeline.db.connection import get_connection


def org_status_counts(settings: Settings) -> dict[str, int]:
    with get_connection(settings) as conn:
        rows = conn.execute("SELECT status, COUNT(*) FROM organizations GROUP BY status ORDER BY status").fetchall()
        return {str(status): int(count) for status, count in rows}


def recent_errors(settings: Settings, *, limit: int = 20) -> list[dict[str, Any]]:
    with get_connection(settings) as conn:
        rows = conn.execute(
            "SELECT organization_id, worker_name, error_type, error_message, occurred_at "
            "FROM errors ORDER BY occurred_at DESC LIMIT %s",
            (limit,),
        ).fetchall()
        return [
            {"organization_id": r[0], "worker_name": r[1], "error_type": r[2], "error_message": r[3], "occurred_at": r[4]}
            for r in rows
        ]


def organization_detail(organization_id: UUID, settings: Settings) -> dict[str, Any] | None:
    with get_connection(settings) as conn:
        org = conn.execute(
            "SELECT legal_name, status, icp_score, opportunity_tier FROM organizations WHERE organization_id = %s",
            (str(organization_id),),
        ).fetchone()
        if org is None:
            return None
        recent_logs = conn.execute(
            "SELECT stage, message, level, created_at FROM processing_logs "
            "WHERE organization_id = %s ORDER BY created_at DESC LIMIT 20",
            (str(organization_id),),
        ).fetchall()
        return {
            "legal_name": org[0], "status": org[1], "icp_score": org[2], "opportunity_tier": org[3],
            "recent_logs": [{"stage": r[0], "message": r[1], "level": r[2], "at": r[3]} for r in recent_logs],
        }
