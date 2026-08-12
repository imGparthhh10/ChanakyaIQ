"""Stage 9 entry point.

Final status decision (judgment call, see pipeline/README.md): the org_status enum's forward
path is ... -> ICP_RUNNING -> QUALIFIED -> ACTIVE, with REJECTED / REVIEW_QUEUE as off-ramps.
ACTIVE represents an organization that has *become a customer* -- a downstream business/sales
outcome this pipeline has no information to determine from ICP scoring alone. This stage only
ever sets QUALIFIED or REJECTED; ACTIVE is left for a separate, later process (e.g. CRM
integration) to set once a qualified organization actually converts.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from pipeline.config import Settings
from pipeline.db.connection import get_connection
from pipeline.db.observability import log_processing, record_error
from pipeline.db.org_status import set_org_status
from pipeline.enums import LogLevel, OrgStatus
from pipeline.icp.client import BackendAuthNotConfigured, BackendClient
from pipeline.icp.repository import get_icp_outcome

_WORKER_NAME = "IcpHandoffWorker"


async def run_icp_handoff(organization_id: UUID, settings: Settings, *, client: BackendClient | None = None) -> dict[str, Any] | None:
    with get_connection(settings) as conn:
        set_org_status(conn, organization_id, OrgStatus.ICP_RUNNING)

    client = client or BackendClient(settings)
    try:
        summary = await client.run_icp_scoring()
    except BackendAuthNotConfigured as exc:
        with get_connection(settings) as conn:
            set_org_status(conn, organization_id, OrgStatus.REVIEW_QUEUE)
            log_processing(conn, organization_id=organization_id, stage="ICP_HANDOFF", message=str(exc), level=LogLevel.WARN)
        return None
    except Exception as exc:  # noqa: BLE001 -- backend unreachable, HTTP error, etc. -- never crashes the run
        with get_connection(settings) as conn:
            record_error(conn, organization_id=organization_id, worker_name=_WORKER_NAME, error_type=type(exc).__name__, exc=exc)
            set_org_status(conn, organization_id, OrgStatus.REVIEW_QUEUE)
            log_processing(
                conn, organization_id=organization_id, stage="ICP_HANDOFF",
                message=f"POST /icp/run failed: {exc}", level=LogLevel.WARN,
            )
        return None

    with get_connection(settings) as conn:
        outcome = get_icp_outcome(conn, organization_id)
        if outcome is None:
            set_org_status(conn, organization_id, OrgStatus.REVIEW_QUEUE)
            return None

        final_status = OrgStatus.QUALIFIED if outcome["is_qualified"] else OrgStatus.REJECTED
        set_org_status(conn, organization_id, final_status)
        log_processing(
            conn, organization_id=organization_id, stage="ICP_HANDOFF",
            message=f"ICP run complete (org-wide: {summary.get('organizationsScored')} scored, "
            f"{summary.get('qualified')} qualified). This org: score={outcome['icp_score']}, "
            f"tier={outcome['opportunity_tier']}, qualified={outcome['is_qualified']}, "
            f"tags={outcome['tags']}. Status -> {final_status.value}.",
            level=LogLevel.INFO,
        )

    return {"organization_id": organization_id, "final_status": final_status, **outcome}
