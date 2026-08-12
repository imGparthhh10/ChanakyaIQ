"""logger: the single centralized consumer of the `logs` and `rejected`
streams. Every other service publishes structured events instead of
writing its own log files -- this is the one place that persists the
auditable timeline for the whole run, to a JSON-Lines file on a mounted
volume (so it survives container restarts and is inspectable with plain
`grep`/`jq` after the run, not just via `docker compose logs`).

Also prints a human-readable line per event to stdout so
`docker compose logs -f logger` is a live, readable feed of the entire
pipeline's activity in one place.
"""
from __future__ import annotations

import json
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

from shared.queue_client import DEAD_LETTER_STREAM, LOGS_STREAM, QueueClient, StreamMessage  # noqa: E402

REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379/0")
REJECTED_STREAM = os.environ.get("REJECTED_STREAM", "rejected")
LOG_OUTPUT_DIR = os.environ.get("LOG_OUTPUT_DIR", "/data/logs")
BATCH_SIZE = int(os.environ.get("LOGGER_BATCH_SIZE", "50"))
SUMMARY_INTERVAL_S = int(os.environ.get("LOGGER_SUMMARY_INTERVAL_S", "60"))

LOGS_GROUP = "logger"
REJECTED_GROUP = "logger_rejected"
DEAD_LETTER_GROUP = "logger_dead_letter"


class Counters:
    def __init__(self) -> None:
        self.log_events = 0
        self.rejected = 0
        self.dead_lettered = 0
        self.errors = 0
        self.warnings = 0

    def as_dict(self) -> dict[str, int]:
        return {
            "log_events": self.log_events, "rejected": self.rejected,
            "dead_lettered": self.dead_lettered, "errors": self.errors, "warnings": self.warnings,
        }


def _audit_path() -> Path:
    d = Path(LOG_OUTPUT_DIR)
    d.mkdir(parents=True, exist_ok=True)
    return d / "audit_log.jsonl"


def _write_audit_line(f, kind: str, data: dict) -> None:
    line = {"kind": kind, "recorded_at": time.time(), **data}
    f.write(json.dumps(line, default=str) + "\n")
    f.flush()


def _print_human(kind: str, data: dict) -> None:
    if kind == "log":
        level = data.get("level", "info").upper()
        stage = data.get("stage", "?")
        entity = data.get("entity_name") or data.get("entity_id") or "-"
        print(f"[{level}] {stage} :: {entity} :: {data.get('message', '')}", flush=True)
    elif kind == "rejected":
        print(f"[REJECTED] {data.get('stage', '?')} :: {data.get('entity_name', '-')} :: {data.get('reason', '')}", flush=True)
    elif kind == "dead_letter":
        print(
            f"[DEAD-LETTER] stream={data.get('original_stream')} attempts={data.get('attempts')} "
            f"error={data.get('last_error')}", flush=True,
        )


def main() -> None:
    queue = QueueClient(REDIS_URL, consumer_name="logger")
    queue.ensure_group(LOGS_STREAM, LOGS_GROUP)
    queue.ensure_group(REJECTED_STREAM, REJECTED_GROUP)
    queue.ensure_group(DEAD_LETTER_STREAM, DEAD_LETTER_GROUP)

    counters = Counters()
    audit_path = _audit_path()
    print(f"logger starting -- audit trail: {audit_path}", flush=True)

    last_summary = time.time()

    with open(audit_path, "a", encoding="utf-8") as audit_file:
        while True:
            try:
                log_msgs = queue.read_group(LOGS_STREAM, LOGS_GROUP, count=BATCH_SIZE, block_ms=1000)
                for m in log_msgs:
                    _handle(m, "log", LOGS_STREAM, LOGS_GROUP, queue, counters, audit_file)

                rejected_msgs = queue.read_group(REJECTED_STREAM, REJECTED_GROUP, count=BATCH_SIZE, block_ms=1000)
                for m in rejected_msgs:
                    _handle(m, "rejected", REJECTED_STREAM, REJECTED_GROUP, queue, counters, audit_file)

                dl_msgs = queue.read_group(DEAD_LETTER_STREAM, DEAD_LETTER_GROUP, count=BATCH_SIZE, block_ms=1000)
                for m in dl_msgs:
                    _handle(m, "dead_letter", DEAD_LETTER_STREAM, DEAD_LETTER_GROUP, queue, counters, audit_file)
            except Exception as exc:  # noqa: BLE001 - the logger itself must never crash the pipeline
                print(f"[LOGGER-ERROR] failed to read/process a batch: {exc}", flush=True)
                time.sleep(3.0)
                continue

            if time.time() - last_summary >= SUMMARY_INTERVAL_S:
                print(f"[SUMMARY] {json.dumps(counters.as_dict())}", flush=True)
                last_summary = time.time()


def _handle(msg: StreamMessage, kind: str, stream: str, group: str, queue: QueueClient, counters: Counters, audit_file) -> None:
    try:
        data = msg.data
        if "__decode_error__" in data:
            counters.errors += 1
            queue.ack(stream, group, msg.id)
            return

        if kind == "log":
            counters.log_events += 1
            level = data.get("level")
            if level == "error":
                counters.errors += 1
            elif level == "warning":
                counters.warnings += 1
        elif kind == "rejected":
            counters.rejected += 1
        elif kind == "dead_letter":
            counters.dead_lettered += 1

        _write_audit_line(audit_file, kind, data)
        _print_human(kind, data)
        queue.ack(stream, group, msg.id)
    except Exception as exc:  # noqa: BLE001 - one bad event must not stop the audit trail
        print(f"[LOGGER-ERROR] failed to process one {kind} event: {exc}", flush=True)
        try:
            queue.ack(stream, group, msg.id)
        except Exception:  # noqa: BLE001
            pass


if __name__ == "__main__":
    main()
