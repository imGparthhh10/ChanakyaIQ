"""Shared fixtures.

DB-touching tests (marked with the `db` fixture, currently just the e2e test) run against a
throwaway Postgres *database* created fresh for the test session by dumping the real dev
database's schema-only DDL (via pg_dump) and restoring it into a new, empty database (via
psql) -- objects land in that new database's own `public` schema unmodified, so no
schema-qualification rewriting is needed. Torn down (DROP DATABASE) at session end.

This exercises the actual Postgres enums/constraints/trigram index the pipeline depends on,
not a mock -- closer to the real thing than an in-memory fake DB layer would be, and still
fully isolated from the real dev/prod data. Everything else (unit tests for pure logic) needs
no database, no network, no browser, and no optional ML dependency, per the build spec.
"""

from __future__ import annotations

import os
import subprocess
import uuid
from pathlib import Path
from urllib.parse import urlparse, urlunparse

import psycopg
import pytest

from pipeline.config import REPO_ROOT, Settings

PG_BIN_CANDIDATES = [
    Path(r"C:\Program Files\PostgreSQL\18\bin"),
    Path(r"C:\Program Files\PostgreSQL\17\bin"),
    Path(r"C:\Program Files\PostgreSQL\16\bin"),
]


def _find_pg_bin() -> Path | None:
    for candidate in PG_BIN_CANDIDATES:
        if (candidate / "pg_dump.exe").exists():
            return candidate
    return None


def _dev_database_url() -> str:
    """Reads DATABASE_URL the same way the app does -- backend/.env -- without going through
    the process-wide Settings singleton (get_settings()), since tests construct their own
    Settings pointed at the temp test database instead."""
    env_path = REPO_ROOT / "backend" / ".env"
    for line in env_path.read_text(encoding="utf-8").splitlines():
        if line.startswith("DATABASE_URL="):
            return line.split("=", 1)[1].strip().strip('"')
    raise RuntimeError(f"DATABASE_URL not found in {env_path}")


@pytest.fixture(scope="session")
def temp_database_url() -> str:
    pg_bin = _find_pg_bin()
    if pg_bin is None:
        pytest.skip("PostgreSQL client tools (pg_dump/psql) not found -- skipping DB-backed tests.")

    dev_url = _dev_database_url()
    # Prisma's connection string carries a `?schema=public` query param that Prisma itself
    # understands but psycopg/pg_dump/psql do not -- stripped here since none of this test
    # setup goes through Prisma.
    parsed = urlparse(dev_url)._replace(query="")
    test_db_name = f"eip_pipeline_test_{uuid.uuid4().hex[:8]}"
    admin_url = urlunparse(parsed._replace(path="/postgres"))
    test_url = urlunparse(parsed._replace(path=f"/{test_db_name}"))

    with psycopg.connect(admin_url, autocommit=True) as conn:
        conn.execute(f'CREATE DATABASE "{test_db_name}"')

    dev_url_stripped = urlunparse(urlparse(dev_url)._replace(query=""))
    dump_path = Path(os.environ.get("TEMP", "/tmp")) / f"{test_db_name}.sql"
    try:
        subprocess.run(
            [str(pg_bin / "pg_dump.exe"), "--schema-only", "--no-owner", "--no-privileges", dev_url_stripped, "-f", str(dump_path)],
            check=True, capture_output=True, text=True,
        )
        subprocess.run(
            [str(pg_bin / "psql.exe"), test_url, "-f", str(dump_path), "-v", "ON_ERROR_STOP=1"],
            check=True, capture_output=True, text=True,
        )
    except subprocess.CalledProcessError as exc:
        pytest.fail(f"Failed to set up temp test database: {exc.stderr}")
    finally:
        dump_path.unlink(missing_ok=True)

    yield test_url

    with psycopg.connect(admin_url, autocommit=True) as conn:
        conn.execute(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = %s AND pid <> pg_backend_pid()",
            (test_db_name,),
        )
        conn.execute(f'DROP DATABASE IF EXISTS "{test_db_name}"')


@pytest.fixture(scope="session")
def test_settings(temp_database_url: str, tmp_path_factory: pytest.TempPathFactory) -> Settings:
    storage_root = tmp_path_factory.mktemp("eip_pipeline_docs")
    return Settings(
        DATABASE_URL=temp_database_url,
        PIPELINE_STORAGE_ROOT=storage_root,
        PIPELINE_MIN_EXTRACTABLE_CHARS=20,  # short fake fixture text still passes the quality gate
    )


@pytest.fixture(autouse=True)
def _reset_db_pool():
    """The connection pool (pipeline.db.connection) is a process-wide singleton keyed to
    whichever Settings first initialized it -- reset it before/after each test so a DB test
    always gets a pool bound to test_settings' temp database, never a stale one from an earlier
    test module."""
    from pipeline.db import connection

    connection.close_pool()
    yield
    connection.close_pool()
