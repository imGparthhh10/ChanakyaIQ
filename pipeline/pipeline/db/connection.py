"""A single shared psycopg3 connection pool for the whole pipeline process.

Prisma owns the schema (migrations live in backend/prisma/). This module — and everything
under pipeline/db/ — only ever issues parameterized DML against tables that already exist.
No DDL is ever executed here.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from psycopg import Connection
from psycopg_pool import ConnectionPool

from pipeline.config import Settings, get_settings

_pool: ConnectionPool | None = None


def get_pool(settings: Settings | None = None) -> ConnectionPool:
    global _pool
    if _pool is None:
        s = settings or get_settings()
        _pool = ConnectionPool(
            conninfo=s.database_url,
            min_size=s.db_pool_min_size,
            max_size=s.db_pool_max_size,
            open=True,
        )
    return _pool


def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


@contextmanager
def get_connection(settings: Settings | None = None) -> Iterator[Connection]:
    """One connection, one transaction. Commits on clean exit, rolls back on exception."""
    pool = get_pool(settings)
    with pool.connection() as conn:
        yield conn
