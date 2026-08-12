"""Shared logging helpers every stage repository uses — mirrors the Node backend's own
convention (see crawler.service.ts / enrichment.service.ts): a job_history row per worker run,
a processing_logs row per stage transition or warning, and an errors row per exception with its
stack trace. This is the operator's only window into the pipeline (rule 4 of the build spec).
"""

from __future__ import annotations

import json
import traceback
import uuid
from datetime import UTC, datetime
from typing import Any

from psycopg import Connection

from pipeline.enums import LogLevel


def log_processing(
    conn: Connection,
    *,
    organization_id: uuid.UUID | str | None,
    stage: str,
    message: str,
    level: LogLevel = LogLevel.INFO,
) -> None:
    conn.execute(
        "INSERT INTO processing_logs (organization_id, stage, message, level) "
        "VALUES (%s, %s, %s, %s)",
        (str(organization_id) if organization_id else None, stage, message, str(level)),
    )


def start_job_history(
    conn: Connection,
    *,
    worker_name: str,
    organization_id: uuid.UUID | str | None,
    reference_id: uuid.UUID | str | None = None,
    details: dict[str, Any] | None = None,
) -> int:
    row = conn.execute(
        "INSERT INTO job_history (worker_name, organization_id, reference_id, status, details_json) "
        "VALUES (%s, %s, %s, 'STARTED', %s) RETURNING job_history_id",
        (
            worker_name,
            str(organization_id) if organization_id else None,
            str(reference_id) if reference_id else None,
            json.dumps(details) if details is not None else None,
        ),
    ).fetchone()
    assert row is not None
    return int(row[0])


def finish_job_history(
    conn: Connection,
    job_history_id: int,
    *,
    status: str,
    reference_id: uuid.UUID | str | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    conn.execute(
        "UPDATE job_history SET status = %s, finished_at = %s, "
        "reference_id = COALESCE(%s, reference_id), "
        "details_json = COALESCE(%s, details_json) "
        "WHERE job_history_id = %s",
        (
            status,
            datetime.now(UTC),
            str(reference_id) if reference_id else None,
            json.dumps(details) if details is not None else None,
            job_history_id,
        ),
    )


def record_error(
    conn: Connection,
    *,
    organization_id: uuid.UUID | str | None,
    worker_name: str,
    error_type: str,
    exc: BaseException,
) -> None:
    stack = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
    conn.execute(
        "INSERT INTO errors (organization_id, worker_name, error_type, error_message, stack_trace) "
        "VALUES (%s, %s, %s, %s, %s)",
        (
            str(organization_id) if organization_id else None,
            worker_name,
            error_type,
            str(exc)[:2000],
            stack[:20000],
        ),
    )
