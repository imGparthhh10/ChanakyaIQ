"""db_writer: consumes ScoredRecord from write-jobs, validates it (fuzzy
entity confirmation, state match, India-only scope check, in-run
duplicate-value check), and only then writes it to Postgres and appends
it to the enriched Excel output. A record already in the database is
never overwritten unless OVERWRITE_EXISTING=true.

Every validation pass/fail is logged with its specific reason via the
centralized `logs` stream -- this is the file the "why wasn't X written"
question gets answered from.
"""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

def _add_shared_to_path() -> None:
    """Locate the `shared` package regardless of layout: a sibling of this
    file inside the built Docker image (services/<name>/main.py is COPYed
    to /app/main.py, shared/ to /app/shared -- one level up), or two
    directories up when running this file directly from a source
    checkout (services/<name>/main.py -> enrichment_pipeline/shared)."""
    here = Path(__file__).resolve().parent
    for candidate in (here, *here.parents):
        if (candidate / "shared" / "__init__.py").exists():
            sys.path.insert(0, str(candidate))
            return
    raise RuntimeError(f"could not locate the 'shared' package from {here}")


_add_shared_to_path()

from pydantic import ValidationError  # noqa: E402

from db import Database  # noqa: E402
from excel_writer import EnrichedExcelWriter  # noqa: E402
from validators import (  # noqa: E402
    duplicate_value_fingerprint,
    entity_confirmed_in_evidence,
    india_scope_ok,
    state_match,
)
from shared.logging_events import EventLogger  # noqa: E402
from shared.models import ScoredRecord  # noqa: E402
from shared.queue_client import QueueClient, StreamMessage  # noqa: E402

STAGE = "db_writer"
REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379/0")
WRITE_JOBS_STREAM = os.environ.get("WRITE_JOBS_STREAM", "write-jobs")
GROUP = "db_writer"
BATCH_SIZE = int(os.environ.get("DB_WRITER_BATCH_SIZE", "10"))

# host.docker.internal, not a service name: db_writer's container lives in
# enrichment_pipeline's own Docker Compose project, a separate network
# from the dashboard's postgres container -- reaching it by service name
# isn't possible without merging the two networks, so this goes out to
# the host and back in via the dashboard's already-published port
# instead. Works on Docker Desktop (Windows/Mac); see README.md if this
# ever needs to run under native Linux Docker, where the host gateway is
# reached differently.
DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://esds_app:devpassword@host.docker.internal:5434/esds_eip_dev")
INPUT_DIR = os.environ.get("INPUT_DIR", "/data/input")
OUTPUT_DIR = os.environ.get("OUTPUT_DIR", "/data/output")
OVERWRITE_EXISTING = os.environ.get("OVERWRITE_EXISTING", "false").lower() == "true"


class RunState:
    """In-process, single-run state. The DB's PRIMARY KEY already makes
    "same entity twice" durably safe across restarts; this only tracks
    the softer cross-entity value-fingerprint check and which entities
    have already been appended to the Excel output this run (to avoid
    duplicate Excel rows on a redelivered message)."""

    def __init__(self) -> None:
        self.seen_fingerprints: dict[str, str] = {}  # fingerprint -> entity_id
        self.excel_written_entity_ids: set[str] = set()


def validate_record(record: ScoredRecord, state: RunState) -> tuple[bool, str]:
    ok, _ratio, reason = entity_confirmed_in_evidence(record.entity_name, record.raw_snippet, record.report_name, record.source_url)
    if not ok:
        return False, f"entity-confirmation failed: {reason}"

    ok, reason = state_match(record.detected_state, record.state)
    if not ok:
        return False, f"state check failed: {reason}"

    ok, reason = india_scope_ok(record.model_dump())
    if not ok:
        return False, f"scope check failed: {reason}"

    fingerprint = duplicate_value_fingerprint(record.model_dump())
    if fingerprint is not None:
        existing_owner = state.seen_fingerprints.get(fingerprint)
        if existing_owner is not None and existing_owner != record.entity_id:
            return False, f"duplicate value fingerprint already written for a different entity ({existing_owner})"
        state.seen_fingerprints[fingerprint] = record.entity_id

    return True, "all validations passed"


def handle_message(
    msg: StreamMessage, db: Database, excel: EnrichedExcelWriter, state: RunState, queue: QueueClient, evlog: EventLogger
) -> None:
    if "__decode_error__" in msg.data:
        evlog.error("undecodable message on write-jobs, dead-lettering", details={"raw": msg.data})
        queue.dead_letter(WRITE_JOBS_STREAM, GROUP, msg.id, msg.data, attempts=1, last_error="json decode error")
        queue.ack(WRITE_JOBS_STREAM, GROUP, msg.id)
        return

    try:
        record = ScoredRecord.model_validate(msg.data)
    except ValidationError as exc:
        evlog.error(f"invalid ScoredRecord, dead-lettering: {exc}", details={"raw": msg.data})
        queue.dead_letter(WRITE_JOBS_STREAM, GROUP, msg.id, msg.data, attempts=1, last_error=str(exc))
        queue.ack(WRITE_JOBS_STREAM, GROUP, msg.id)
        return

    try:
        ok, reason = validate_record(record, state)
        if not ok:
            evlog.warning(f"validation failed for {record.entity_name}: {reason}", entity_id=record.entity_id, entity_name=record.entity_name)
            queue.ack(WRITE_JOBS_STREAM, GROUP, msg.id)
            return

        already_exists = db.exists(record.entity_id, record.entity_name)
        if already_exists and not OVERWRITE_EXISTING:
            evlog.info(
                f"skipping {record.entity_name}: already in database and OVERWRITE_EXISTING is false",
                entity_id=record.entity_id, entity_name=record.entity_name,
            )
            queue.ack(WRITE_JOBS_STREAM, GROUP, msg.id)
            return

        written = db.write(record.model_dump(), overwrite=OVERWRITE_EXISTING)
        if written and record.entity_id not in state.excel_written_entity_ids:
            excel.append_record(record.model_dump())
            excel.save()
            state.excel_written_entity_ids.add(record.entity_id)

        evlog.info(
            f"wrote {record.entity_name} to database (overwrite={OVERWRITE_EXISTING}, was_existing={already_exists})",
            entity_id=record.entity_id, entity_name=record.entity_name, icp_score=record.icp_score,
        )
        queue.ack(WRITE_JOBS_STREAM, GROUP, msg.id)
    except Exception as exc:  # noqa: BLE001 - never crash the consumer loop
        evlog.error(
            f"write failed for {record.entity_name}, leaving un-acked for orchestrator retry/dead-letter: {exc}",
            entity_id=record.entity_id, entity_name=record.entity_name,
        )


def main() -> None:
    queue = QueueClient(REDIS_URL, consumer_name="db_writer")
    evlog = EventLogger(STAGE, queue)
    queue.ensure_group(WRITE_JOBS_STREAM, GROUP)

    db = Database(DATABASE_URL)
    excel = EnrichedExcelWriter(INPUT_DIR, OUTPUT_DIR)
    state = RunState()

    evlog.info(
        "db_writer starting", overwrite_existing=OVERWRITE_EXISTING,
        preserving_original_excel=excel.preserving_original, output_path=str(excel.output_path),
    )

    while True:
        try:
            messages = queue.read_group(WRITE_JOBS_STREAM, GROUP, count=BATCH_SIZE, block_ms=5000)
        except Exception as exc:  # noqa: BLE001 - transient redis hiccups must not kill the container
            evlog.error(f"failed to read from {WRITE_JOBS_STREAM}: {exc}")
            time.sleep(3.0)
            continue

        for msg in messages:
            handle_message(msg, db, excel, state, queue, evlog)


if __name__ == "__main__":
    main()
