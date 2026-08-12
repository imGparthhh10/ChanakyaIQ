"""Queue-health monitoring + stuck-job recovery for the orchestrator.

Redis Streams consumer groups track a Pending Entries List (PEL) per
group: every message a consumer has been handed but not yet XACK'd. If a
consumer dies (or a job just hangs) mid-processing, that message sits in
the PEL forever with nobody coming back for it -- XREADGROUP with `>`
only ever hands out *new* messages, it never re-delivers PEL entries on
its own. That's the job of this module: periodically find PEL entries
idle longer than the configured threshold, and either requeue them (by
re-publishing a fresh copy of the payload and ack'ing the stuck one) up
to a retry budget, or move them to the dead-letter stream once that
budget is exhausted -- so one stuck job can never block the rest of the
pipeline indefinitely.

The retry count travels *inside the payload* (`_orchestrator_retry_count`)
rather than relying on Redis's own per-message delivery counter, because
re-publishing intentionally creates a brand-new stream entry (Redis has
no "redeliver in place" primitive for XREADGROUP) and we need the retry
history to survive that.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field

from shared.queue_client import DEAD_LETTER_STREAM, LOGS_STREAM, QueueClient

log = logging.getLogger("orchestrator.monitor")

RETRY_COUNT_KEY = "_orchestrator_retry_count"

# (stream, consumer_group) pairs that make up the pipeline topology.
TOPOLOGY: list[tuple[str, str]] = [
    ("crawl-jobs", "crawler"),
    ("translate-jobs", "translator"),
    ("extract-jobs", "extractor"),
    ("score-jobs", "icp_scorer"),
    ("write-jobs", "db_writer"),
    ("rejected", "logger_rejected"),
    (LOGS_STREAM, "logger"),
]


@dataclass
class SweepStats:
    requeued: int = 0
    dead_lettered: int = 0
    by_stream: dict[str, dict[str, int]] = field(default_factory=dict)

    def record(self, stream: str, requeued: int, dead_lettered: int) -> None:
        self.requeued += requeued
        self.dead_lettered += dead_lettered
        self.by_stream[stream] = {"requeued": requeued, "dead_lettered": dead_lettered}


def sweep_stream(
    queue: QueueClient, stream: str, group: str, stuck_idle_ms: int, max_retries: int, batch: int = 50
) -> tuple[int, int]:
    """One sweep pass over one (stream, group). Returns (requeued, dead_lettered)."""
    requeued = 0
    dead_lettered = 0
    try:
        claimed = queue.autoclaim_stale(stream, group, min_idle_ms=stuck_idle_ms, count=batch)
    except Exception as exc:  # noqa: BLE001 - a monitoring failure must never crash the orchestrator
        log.warning("failed to sweep %s/%s: %s", stream, group, exc)
        return 0, 0

    for msg in claimed:
        try:
            if "__decode_error__" in msg.data:
                queue.dead_letter(stream, group, msg.id, msg.data, attempts=1, last_error="undecodable message stuck in PEL")
                queue.ack(stream, group, msg.id)
                dead_lettered += 1
                continue

            payload = msg.data
            retry_count = int(payload.get(RETRY_COUNT_KEY, 0))
            if retry_count >= max_retries:
                queue.dead_letter(
                    stream, group, msg.id, payload, attempts=retry_count,
                    last_error=f"idle >= {stuck_idle_ms}ms and exceeded {max_retries} retries",
                )
                queue.ack(stream, group, msg.id)
                queue.log_event(
                    "orchestrator", f"dead-lettered stuck message on {stream} after {retry_count} retries",
                    level="error", stream=stream, group=group,
                )
                dead_lettered += 1
            else:
                payload[RETRY_COUNT_KEY] = retry_count + 1
                queue.publish(stream, payload)
                queue.ack(stream, group, msg.id)
                queue.log_event(
                    "orchestrator", f"requeued stuck message on {stream} (retry {retry_count + 1}/{max_retries})",
                    level="warning", stream=stream, group=group,
                )
                requeued += 1
        except Exception as exc:  # noqa: BLE001 - one bad stuck message must not stop the sweep
            log.error("failed to handle stuck message %s on %s/%s: %s", msg.id, stream, group, exc)
            try:
                queue.ack(stream, group, msg.id)
            except Exception:  # noqa: BLE001
                pass

    return requeued, dead_lettered


def sweep_all(queue: QueueClient, stuck_idle_ms: int, max_retries: int) -> SweepStats:
    stats = SweepStats()
    for stream, group in TOPOLOGY:
        requeued, dead_lettered = sweep_stream(queue, stream, group, stuck_idle_ms, max_retries)
        if requeued or dead_lettered:
            stats.record(stream, requeued, dead_lettered)
    return stats


def build_status_snapshot(queue: QueueClient) -> dict:
    streams: dict[str, dict] = {}
    for stream, group in TOPOLOGY:
        pending = queue.pending_summary(stream, group) or {"pending": 0}
        streams[stream] = {
            "group": group,
            "queue_depth": queue.xlen(stream),
            "pending_count": pending.get("pending", 0),
        }
    streams[DEAD_LETTER_STREAM] = {"group": None, "queue_depth": queue.xlen(DEAD_LETTER_STREAM), "pending_count": 0}
    return {"streams": streams}
