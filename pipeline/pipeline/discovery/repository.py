"""Persists discovery candidates to crawl_sources. crawl_sources has no unique constraint in
the schema (only a PK) — idempotency for this stage is enforced here, at the application layer,
via an INSERT ... WHERE NOT EXISTS per candidate so re-running discovery on an organization
that already has a source at that exact URL never creates a duplicate row.
"""

from __future__ import annotations

from psycopg import Connection

from pipeline.db.observability import log_processing
from pipeline.discovery.schema import DiscoveryResult
from pipeline.enums import LogLevel


def save_candidates(conn: Connection, result: DiscoveryResult) -> int:
    inserted = 0
    for c in result.candidates:
        cur = conn.execute(
            "INSERT INTO crawl_sources (organization_id, source_type, url) "
            "SELECT %s, %s::document_type, %s "
            "WHERE NOT EXISTS ("
            "  SELECT 1 FROM crawl_sources WHERE organization_id = %s AND url = %s"
            ")",
            (
                str(result.organization_id),
                str(c.source_type),
                c.url,
                str(result.organization_id),
                c.url,
            ),
        )
        inserted += cur.rowcount

    log_processing(
        conn,
        organization_id=result.organization_id,
        stage="DISCOVERY",
        message=(
            f"Discovered {len(result.candidates)} candidate sources "
            f"({result.total_generated} generated, "
            f"{result.total_generated - result.total_after_filter} filtered below confidence "
            f"threshold or deduped); {inserted} new row(s) written, "
            f"{len(result.candidates) - inserted} already existed."
        ),
        level=LogLevel.INFO if result.candidates else LogLevel.WARN,
    )
    return inserted
