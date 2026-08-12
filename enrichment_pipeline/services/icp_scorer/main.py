"""icp_scorer: consumes ExtractedRecord from score-jobs, scores it against
the configurable rule set in config/scoring_rules.yaml (see rules.py),
and routes it: qualified -> write-jobs (as a ScoredRecord), disqualified
-> rejected (as a RejectedRecord with the specific reason).
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

from rules import DEFAULT_CONFIG_PATH, ScoringConfig, score_record  # noqa: E402
from shared.logging_events import EventLogger  # noqa: E402
from shared.models import ExtractedRecord, RejectedRecord, ScoredRecord  # noqa: E402
from shared.queue_client import QueueClient, StreamMessage  # noqa: E402

STAGE = "icp_scorer"
REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379/0")
SCORE_JOBS_STREAM = os.environ.get("SCORE_JOBS_STREAM", "score-jobs")
WRITE_JOBS_STREAM = os.environ.get("WRITE_JOBS_STREAM", "write-jobs")
REJECTED_STREAM = os.environ.get("REJECTED_STREAM", "rejected")
GROUP = "icp_scorer"
BATCH_SIZE = int(os.environ.get("ICP_SCORER_BATCH_SIZE", "10"))
SCORING_CONFIG_PATH = os.environ.get("SCORING_CONFIG_PATH", DEFAULT_CONFIG_PATH)


def process_job(record: ExtractedRecord, config: ScoringConfig) -> ScoredRecord:
    score, breakdown, qualified, reason = score_record(record.model_dump(), config)
    return ScoredRecord(
        **record.model_dump(),
        icp_score=score, qualified=qualified, score_breakdown=breakdown, reason=reason,
    )


def handle_message(msg: StreamMessage, config: ScoringConfig, queue: QueueClient, evlog: EventLogger) -> None:
    if "__decode_error__" in msg.data:
        evlog.error("undecodable message on score-jobs, dead-lettering", details={"raw": msg.data})
        queue.dead_letter(SCORE_JOBS_STREAM, GROUP, msg.id, msg.data, attempts=1, last_error="json decode error")
        queue.ack(SCORE_JOBS_STREAM, GROUP, msg.id)
        return

    try:
        record = ExtractedRecord.model_validate(msg.data)
    except ValidationError as exc:
        evlog.error(f"invalid ExtractedRecord, dead-lettering: {exc}", details={"raw": msg.data})
        queue.dead_letter(SCORE_JOBS_STREAM, GROUP, msg.id, msg.data, attempts=1, last_error=str(exc))
        queue.ack(SCORE_JOBS_STREAM, GROUP, msg.id)
        return

    try:
        scored = process_job(record, config)
        if scored.qualified:
            queue.publish(WRITE_JOBS_STREAM, scored.model_dump())
            evlog.info(
                f"qualified {record.entity_name}: score={scored.icp_score:.0f}",
                entity_id=record.entity_id, entity_name=record.entity_name, score=scored.icp_score,
            )
        else:
            rejected = RejectedRecord(
                entity_id=record.entity_id, entity_name=record.entity_name,
                stage=STAGE, reason=scored.reason, details={"score_breakdown": scored.score_breakdown},
            )
            queue.publish(REJECTED_STREAM, rejected.model_dump())
            evlog.info(
                f"rejected {record.entity_name}: {scored.reason}",
                entity_id=record.entity_id, entity_name=record.entity_name, score=scored.icp_score,
            )
        queue.ack(SCORE_JOBS_STREAM, GROUP, msg.id)
    except Exception as exc:  # noqa: BLE001 - never crash the consumer loop
        evlog.error(
            f"scoring failed for {record.entity_name}, leaving un-acked for orchestrator retry/dead-letter: {exc}",
            entity_id=record.entity_id, entity_name=record.entity_name,
        )


def main() -> None:
    queue = QueueClient(REDIS_URL, consumer_name="icp_scorer")
    evlog = EventLogger(STAGE, queue)
    queue.ensure_group(SCORE_JOBS_STREAM, GROUP)
    config = ScoringConfig.load(SCORING_CONFIG_PATH)
    evlog.info("icp_scorer starting", threshold=config.threshold, rules=len(config.rules))

    while True:
        try:
            messages = queue.read_group(SCORE_JOBS_STREAM, GROUP, count=BATCH_SIZE, block_ms=5000)
        except Exception as exc:  # noqa: BLE001 - transient redis hiccups must not kill the container
            evlog.error(f"failed to read from {SCORE_JOBS_STREAM}: {exc}")
            time.sleep(3.0)
            continue

        for msg in messages:
            handle_message(msg, config, queue, evlog)


if __name__ == "__main__":
    main()
