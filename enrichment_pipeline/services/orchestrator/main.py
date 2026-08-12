"""orchestrator: sits outside the main crawl -> translate -> extract ->
score -> write chain and watches it. Every SWEEP_INTERVAL_S seconds it
scans every stream's pending-entries list for messages that have been
sitting un-acked longer than STUCK_IDLE_MS (a container crashed, hung, or
is just slow), requeues them up to MAX_RETRIES times, and dead-letters
anything that still won't go through -- so one stuck entity can never
block the rest of the run.

Also serves a small HTTP `/status` endpoint (queue depths, pending
counts per stage, dead-letter count, cumulative requeue/dead-letter
totals) for at-a-glance run health without grepping logs.
"""
from __future__ import annotations

import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
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

from monitor import build_status_snapshot, sweep_all  # noqa: E402
from shared.logging_events import EventLogger  # noqa: E402
from shared.queue_client import QueueClient  # noqa: E402

STAGE = "orchestrator"
REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379/0")
SWEEP_INTERVAL_S = float(os.environ.get("ORCH_SWEEP_INTERVAL_S", "20"))
STUCK_IDLE_MS = int(os.environ.get("ORCH_STUCK_IDLE_MS", "120000"))  # 2 minutes
MAX_RETRIES = int(os.environ.get("ORCH_MAX_RETRIES", "3"))
# Always 8080 *inside* the container (matches the Dockerfile's EXPOSE) --
# only the HOST side of the port mapping is configurable, via
# ORCH_STATUS_PORT in docker-compose.yml's `ports:` list. Binding to a
# value read from that same env var here would desync from the
# container-side half of that mapping the moment someone changes it to
# avoid a host port conflict (found the hard way -- see README).
STATUS_PORT = 8080


class RunTotals:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.total_requeued = 0
        self.total_dead_lettered = 0
        self.sweeps_run = 0
        self.started_at = time.time()
        self.last_sweep_at: float | None = None

    def record_sweep(self, requeued: int, dead_lettered: int) -> None:
        with self.lock:
            self.total_requeued += requeued
            self.total_dead_lettered += dead_lettered
            self.sweeps_run += 1
            self.last_sweep_at = time.time()

    def as_dict(self) -> dict:
        with self.lock:
            return {
                "total_requeued": self.total_requeued,
                "total_dead_lettered": self.total_dead_lettered,
                "sweeps_run": self.sweeps_run,
                "uptime_s": round(time.time() - self.started_at, 1),
                "last_sweep_at": self.last_sweep_at,
            }


def make_status_handler(queue: QueueClient, totals: RunTotals):
    class StatusHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
            if self.path not in ("/status", "/"):
                self.send_response(404)
                self.end_headers()
                return
            try:
                snapshot = build_status_snapshot(queue)
                snapshot["orchestrator"] = totals.as_dict()
                snapshot["config"] = {
                    "sweep_interval_s": SWEEP_INTERVAL_S,
                    "stuck_idle_ms": STUCK_IDLE_MS,
                    "max_retries": MAX_RETRIES,
                }
                body = json.dumps(snapshot, indent=2, default=str).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except Exception as exc:  # noqa: BLE001 - the status endpoint must never crash the server thread
                body = json.dumps({"error": str(exc)}).encode("utf-8")
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(body)

        def log_message(self, fmt: str, *args) -> None:  # noqa: A002 - silence default request logging to stdout noise
            pass

    return StatusHandler


def run_status_server(queue: QueueClient, totals: RunTotals) -> None:
    handler = make_status_handler(queue, totals)
    server = ThreadingHTTPServer(("0.0.0.0", STATUS_PORT), handler)
    server.serve_forever()


def main() -> None:
    queue = QueueClient(REDIS_URL, consumer_name="orchestrator")
    evlog = EventLogger(STAGE, queue)
    totals = RunTotals()

    server_thread = threading.Thread(target=run_status_server, args=(queue, totals), daemon=True)
    server_thread.start()
    evlog.info(f"orchestrator starting, /status on :{STATUS_PORT}", stuck_idle_ms=STUCK_IDLE_MS, max_retries=MAX_RETRIES)

    while True:
        try:
            stats = sweep_all(queue, STUCK_IDLE_MS, MAX_RETRIES)
            totals.record_sweep(stats.requeued, stats.dead_lettered)
            if stats.requeued or stats.dead_lettered:
                evlog.info(
                    f"sweep: requeued={stats.requeued} dead_lettered={stats.dead_lettered}",
                    details=stats.by_stream,
                )
        except Exception as exc:  # noqa: BLE001 - a bad sweep must never kill the orchestrator
            evlog.error(f"sweep failed: {exc}")
        time.sleep(SWEEP_INTERVAL_S)


if __name__ == "__main__":
    main()
