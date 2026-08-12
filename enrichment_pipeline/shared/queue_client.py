"""Thin Redis Streams wrapper used by every service.

Every stage talks to the queue only through this module -- no service ever
imports another service's code or calls it directly. Swapping the backing
transport (e.g. to RabbitMQ) later means rewriting this one file; no
business logic in any service needs to change, since callers only see
``publish`` / ``read_group`` / ``ack`` / ``dead_letter``.

Stream naming convention (see docker-compose.yml / README for the full
topology):

    crawl-jobs   -> consumer group "crawler"
    translate-jobs -> consumer group "translator"
    extract-jobs -> consumer group "extractor"
    score-jobs   -> consumer group "icp_scorer"
    write-jobs   -> consumer group "db_writer"
    rejected     -> consumer group "logger_rejected"
    logs         -> consumer group "logger"
    dead-letter  -> written by orchestrator, read by logger/db_writer for audit
"""
from __future__ import annotations

import json
import logging
import socket
import time
from dataclasses import dataclass
from typing import Any, Iterable, Optional

import redis

log = logging.getLogger("queue_client")

DEAD_LETTER_STREAM = "dead-letter"
LOGS_STREAM = "logs"


@dataclass
class StreamMessage:
    stream: str
    id: str
    data: dict[str, Any]


class QueueClient:
    """A Redis-Streams-backed pub/sub-with-acks client.

    One instance per process is enough -- it is not stream-bound, so a
    single client can publish to any stream and consume from any
    (stream, group) pair, which is exactly what the orchestrator needs
    when it has to inspect every stream in the topology.
    """

    def __init__(
        self,
        redis_url: str,
        consumer_name: Optional[str] = None,
        socket_timeout: float = 10.0,
        max_connect_retries: int = 30,
        retry_delay_s: float = 2.0,
    ) -> None:
        self.redis_url = redis_url
        self.consumer_name = consumer_name or f"{socket.gethostname()}-{int(time.time())}"
        self._r = self._connect(redis_url, socket_timeout, max_connect_retries, retry_delay_s)

    @staticmethod
    def _connect(url: str, socket_timeout: float, max_retries: int, delay: float) -> redis.Redis:
        last_err: Optional[Exception] = None
        for attempt in range(1, max_retries + 1):
            try:
                client = redis.from_url(
                    url, decode_responses=True, socket_timeout=socket_timeout,
                    socket_connect_timeout=socket_timeout,
                )
                client.ping()
                log.info("connected to redis at %s (attempt %d)", url, attempt)
                return client
            except Exception as exc:  # noqa: BLE001 - deliberately broad: startup retry loop
                last_err = exc
                log.warning("redis not ready (attempt %d/%d): %s", attempt, max_retries, exc)
                time.sleep(delay)
        raise ConnectionError(f"could not connect to redis at {url}: {last_err}")

    # ------------------------------------------------------------------ #
    # Publish
    # ------------------------------------------------------------------ #
    def publish(self, stream: str, payload: dict[str, Any]) -> str:
        """XADD a JSON-encoded payload. Returns the new entry id."""
        try:
            body = json.dumps(payload, default=str)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"payload for stream {stream!r} is not JSON-serializable: {exc}") from exc
        return self._r.xadd(stream, {"payload": body})

    def publish_many(self, stream: str, payloads: Iterable[dict[str, Any]]) -> list[str]:
        ids = []
        pipe = self._r.pipeline()
        count = 0
        for payload in payloads:
            pipe.xadd(stream, {"payload": json.dumps(payload, default=str)})
            count += 1
            if count % 500 == 0:
                ids.extend(pipe.execute())
        if count % 500 != 0:
            ids.extend(pipe.execute())
        return ids

    # ------------------------------------------------------------------ #
    # Consume (consumer-group based, at-least-once, ack-required)
    # ------------------------------------------------------------------ #
    def ensure_group(self, stream: str, group: str) -> None:
        try:
            self._r.xgroup_create(name=stream, groupname=group, id="0", mkstream=True)
            log.info("created consumer group %s on stream %s", group, stream)
        except redis.ResponseError as exc:
            if "BUSYGROUP" in str(exc):
                return
            raise

    def read_group(
        self, stream: str, group: str, count: int = 10, block_ms: int = 5000
    ) -> list[StreamMessage]:
        """Read new messages for this consumer group. Blocks up to
        block_ms waiting for at least one message; returns [] on timeout."""
        self.ensure_group(stream, group)
        resp = self._r.xreadgroup(
            groupname=group, consumername=self.consumer_name,
            streams={stream: ">"}, count=count, block=block_ms,
        )
        out: list[StreamMessage] = []
        for stream_name, entries in resp or []:
            for entry_id, fields in entries:
                data = self._decode(fields)
                if data is None:
                    # Unparsable message: ack it immediately so it doesn't
                    # jam the group forever, but surface it for the caller
                    # to dead-letter / log.
                    out.append(StreamMessage(stream=stream_name, id=entry_id, data={"__decode_error__": fields}))
                else:
                    out.append(StreamMessage(stream=stream_name, id=entry_id, data=data))
        return out

    @staticmethod
    def _decode(fields: dict[str, str]) -> Optional[dict[str, Any]]:
        raw = fields.get("payload")
        if raw is None:
            return None
        try:
            return json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            return None

    def ack(self, stream: str, group: str, entry_id: str) -> None:
        self._r.xack(stream, group, entry_id)

    # ------------------------------------------------------------------ #
    # Dead-letter / logging helpers
    # ------------------------------------------------------------------ #
    def dead_letter(
        self, original_stream: str, original_group: str, entry_id: str,
        payload: dict[str, Any], attempts: int, last_error: str,
    ) -> str:
        envelope = {
            "original_stream": original_stream,
            "original_group": original_group,
            "original_id": entry_id,
            "payload": payload,
            "attempts": attempts,
            "last_error": last_error,
            "moved_at": time.time(),
        }
        return self.publish(DEAD_LETTER_STREAM, envelope)

    def log_event(self, stage: str, message: str, level: str = "info", **details: Any) -> None:
        event = {
            "stage": stage, "level": level, "message": message,
            "details": {k: v for k, v in details.items() if k not in ("entity_id", "entity_name")},
            "entity_id": details.get("entity_id"),
            "entity_name": details.get("entity_name"),
            "ts": time.time(),
        }
        try:
            self.publish(LOGS_STREAM, event)
        except Exception:  # noqa: BLE001 - logging must never crash the caller
            log.exception("failed to publish log event to %s", LOGS_STREAM)

    # ------------------------------------------------------------------ #
    # Orchestrator introspection
    # ------------------------------------------------------------------ #
    def xlen(self, stream: str) -> int:
        try:
            return self._r.xlen(stream)
        except redis.ResponseError:
            return 0

    def pending_summary(self, stream: str, group: str) -> Optional[dict[str, Any]]:
        """XPENDING summary form: {count, min, max, consumers}. None if the
        group/stream doesn't exist yet."""
        try:
            summary = self._r.xpending(stream, group)
        except redis.ResponseError:
            return None
        if not summary or summary.get("pending", 0) == 0:
            return {"pending": 0, "min": None, "max": None, "consumers": []}
        return summary

    def pending_detail(self, stream: str, group: str, count: int = 100) -> list[dict[str, Any]]:
        """XPENDING extended form -- per-message idle time, used to find
        stuck jobs."""
        try:
            return self._r.xpending_range(stream, group, min="-", max="+", count=count)
        except redis.ResponseError:
            return []

    # ------------------------------------------------------------------ #
    # One-shot idempotency guard (e.g. seed_loader)
    # ------------------------------------------------------------------ #
    def try_claim_once(self, marker_key: str, ttl_s: Optional[int] = None) -> bool:
        """Atomically claims `marker_key` (SET NX). Returns True the first
        time this is called for a given key (caller should proceed),
        False on every subsequent call until the key expires or is
        deleted (caller should skip). Exists so a one-shot service whose
        container gets recreated -- e.g. by `docker compose` re-verifying
        a `service_completed_successfully` dependency -- doesn't silently
        redo (and re-publish duplicate jobs for) work it already
        finished."""
        return bool(self._r.set(marker_key, str(time.time()), nx=True, ex=ttl_s))

    def clear_claim(self, marker_key: str) -> None:
        self._r.delete(marker_key)

    def autoclaim_stale(
        self, stream: str, group: str, min_idle_ms: int, count: int = 50
    ) -> list[StreamMessage]:
        """Claim messages idle longer than min_idle_ms so this consumer can
        retry (or dead-letter) them. Used only by the orchestrator."""
        self.ensure_group(stream, group)
        try:
            _cursor, entries, _deleted = self._r.xautoclaim(
                name=stream, groupname=group, consumername=self.consumer_name,
                min_idle_time=min_idle_ms, start_id="0-0", count=count,
            )
        except redis.ResponseError:
            return []
        out = []
        for entry_id, fields in entries:
            data = self._decode(fields) or {"__decode_error__": fields}
            out.append(StreamMessage(stream=stream, id=entry_id, data=data))
        return out

    def group_exists(self, stream: str, group: str) -> bool:
        try:
            groups = self._r.xinfo_groups(stream)
        except redis.ResponseError:
            return False
        return any(g.get("name") == group for g in groups)

    def close(self) -> None:
        try:
            self._r.close()
        except Exception:  # noqa: BLE001
            pass


def run_forever_safely(
    fn, *, stage: str, sleep_on_error_s: float = 3.0, queue: Optional[QueueClient] = None
) -> None:
    """Wrap a service's main loop body so a single unhandled exception in
    one iteration never takes the whole container down -- it logs, sleeps
    briefly, and continues. ``fn`` is called with no arguments once per
    iteration and should itself handle per-job errors (this is only the
    outer safety net for bugs in the loop plumbing itself)."""
    while True:
        try:
            fn()
        except KeyboardInterrupt:
            log.info("%s: shutting down (KeyboardInterrupt)", stage)
            return
        except Exception as exc:  # noqa: BLE001 - top-level container safety net
            log.exception("%s: unhandled error in main loop: %s", stage, exc)
            if queue is not None:
                queue.log_event(stage, f"unhandled loop error: {exc}", level="error")
            time.sleep(sleep_on_error_s)
