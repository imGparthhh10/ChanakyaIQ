"""Structured logging helpers shared by every service.

Two layers, deliberately kept separate:

1. stdout logging via the stdlib ``logging`` module -- this is what
   ``docker compose logs -f <service>`` shows. It exists purely for local
   debugging of one container in isolation; no service writes log *files*
   to disk.
2. The centralized ``logs`` Redis Stream (via ``QueueClient.log_event``)
   -- this is the single auditable timeline across the whole run that the
   ``logger`` service consumes and is the one source of truth for "what
   happened to entity X at stage Y". Every meaningful event (found/not
   found, validation failure, duplicate, dead-letter, qualify/reject)
   must go here, not just to stdout.

``EventLogger`` bundles both so call sites only need one line.
"""
from __future__ import annotations

import json
import logging
import sys
import time
from typing import Any, Optional

from .queue_client import QueueClient


class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": round(time.time(), 3),
            "level": record.levelname.lower(),
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def setup_logging(stage: str, level: int = logging.INFO) -> logging.Logger:
    """Configure stdout logging for a service. Idempotent -- safe to call
    more than once (e.g. from both main.py and a module it imports)."""
    logger = logging.getLogger(stage)
    logger.setLevel(level)
    if not any(isinstance(h, logging.StreamHandler) for h in logger.handlers):
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(_JsonFormatter())
        logger.addHandler(handler)
    logger.propagate = False
    return logger


class EventLogger:
    """Logs to stdout (for `docker compose logs`) AND to the centralized
    `logs` stream (for the `logger` service / final audit trail) in one
    call. Never raises -- a logging failure must not break the caller."""

    def __init__(self, stage: str, queue: QueueClient, stdout_level: int = logging.INFO) -> None:
        self.stage = stage
        self.queue = queue
        self.stdout = setup_logging(stage, stdout_level)

    def _emit(self, level: str, message: str, entity_id: Optional[str], entity_name: Optional[str], **details: Any) -> None:
        getattr(self.stdout, level, self.stdout.info)(
            f"[{entity_id or '-'}] {entity_name or ''} :: {message} :: {details or ''}"
        )
        try:
            self.queue.log_event(
                self.stage, message, level=level,
                entity_id=entity_id, entity_name=entity_name, **details,
            )
        except Exception:  # noqa: BLE001 - logging must never crash the caller
            self.stdout.exception("failed to publish centralized log event")

    def debug(self, message: str, *, entity_id: str | None = None, entity_name: str | None = None, **details: Any) -> None:
        self._emit("debug", message, entity_id, entity_name, **details)

    def info(self, message: str, *, entity_id: str | None = None, entity_name: str | None = None, **details: Any) -> None:
        self._emit("info", message, entity_id, entity_name, **details)

    def warning(self, message: str, *, entity_id: str | None = None, entity_name: str | None = None, **details: Any) -> None:
        self._emit("warning", message, entity_id, entity_name, **details)

    def error(self, message: str, *, entity_id: str | None = None, entity_name: str | None = None, **details: Any) -> None:
        self._emit("error", message, entity_id, entity_name, **details)
