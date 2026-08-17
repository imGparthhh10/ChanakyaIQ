"""Postgres access for db_writer -- writes into the dashboard's real
`esds_eip_dev` database (organizations / addresses / financial_metrics /
technology_metrics via metric_definitions / leadership_profiles), the
same schema and the same discipline every other import in this platform
uses. This replaced an earlier version that wrote into an isolated
`enrichment` database no dashboard page ever reads from -- see
enrichment_pipeline/README.md for the incident writeup.

No parallel schema, no new tables: an enriched entity either matches an
existing organization (by normalized legal name, scoped to BFSI) or
becomes a new one, exactly like the Node backend's Excel importers.
metric_definitions is treated as the dynamic, app-populated lookup table
it already is elsewhere in this codebase -- a metric_key this pipeline
needs that doesn't exist yet (e.g. digital_capex) is created on first
use, not hand-migrated.
"""
from __future__ import annotations

import logging
import re
import time
from typing import Any, Optional

import psycopg

log = logging.getLogger("db_writer.db")

# Mirrors assets/js/data/validator.js's normalizeForDedup() byte-for-byte
# (see backend/src/utils/dedupeKey.ts's comment on why that one function
# is the single source of truth for "are these the same company") -- this
# is a second, deliberate implementation of the same algorithm in Python
# since the Node module can't be imported cross-runtime; keep it in sync
# by hand if that one ever changes.
def normalize_for_dedup(name: str) -> str:
    if not name:
        return ""
    s = name.lower()
    s = re.sub(r"^\s*the\s+", "", s)
    s = re.sub(r"\(.*?\)", "", s)
    s = re.sub(r"\b(limited|ltd\.?|pvt\.?|private|corporation|company|co\.?|inc\.?|llp|llc)\b", "", s)
    s = re.sub(r"[^a-z0-9]", "", s)
    return s.strip()


# ExtractedRecord/ScoredRecord field -> real metric_definitions.metric_key,
# split by which physical table it belongs in (matches
# backend/src/utils/metricFieldMap.ts's FINANCIAL_METRIC_FIELDS split).
FINANCIAL_METRIC_FIELDS = {
    "revenue_inr_cr": "revenue",
    "net_profit_inr_cr": "net_profit",
    "branch_count": "branch_count",
    "employee_count": "employee_count",
}
TECHNOLOGY_METRIC_FIELDS = {
    "it_spend_inr_cr": "it_spend",
    "data_centre_spend_inr_cr": "data_center_spend",
    "cybersecurity_spend_inr_cr": "cybersecurity_spend",
    "cloud_spend_inr_cr": "cloud_spend",
    "digital_capex_inr_cr": "digital_capex",
}
_NEW_METRIC_DEFAULTS = {
    # metric_key -> (display_name, category, unit) for any of the above
    # that metric_definitions doesn't already have a row for.
    "digital_capex": ("Digital Capex", "Technology", "INR_CR"),
}

# ExtractedRecord field -> leadership_profiles column. Matches the real
# table's 4 columns exactly (see shared/models.py's ExtractedRecord
# comment) -- one row per org, so this is a genuine single-row upsert,
# not the multi-row-per-metric shape financial_metrics/technology_metrics
# have.
LEADERSHIP_COLUMNS = {
    "ceo_name": "ceo_name",
    "cto_name": "cto_name",
    "cio_name": "cio_name",
    "chairman_name": "chairman_name",
}


def _parse_money(raw: str) -> Optional[float]:
    """MoneyField values arrive as 'N/A' or a plain numeric-looking
    string (extractor's job, not this module's, to have already stripped
    currency symbols/commas) -- this only handles the 'N/A' vs real value
    split, same missing-is-not-zero discipline as everywhere else in this
    platform's ICP pipeline."""
    if raw is None:
        return None
    s = str(raw).strip()
    if not s or s.upper() == "N/A":
        return None
    try:
        return float(s.replace(",", ""))
    except ValueError:
        return None


class Database:
    def __init__(self, dsn: str, max_retries: int = 30, retry_delay: float = 2.0) -> None:
        self.dsn = dsn
        self._conn = self._connect(max_retries, retry_delay)
        self._metric_id_cache: dict[str, int] = {}
        self._bfsi_sector_id: Optional[int] = None
        self._org_name_cache: Optional[list[tuple[str, str]]] = None  # [(normalized_name, org_id)]

    def _connect(self, max_retries: int, retry_delay: float) -> psycopg.Connection:
        last_err: Optional[Exception] = None
        for attempt in range(1, max_retries + 1):
            try:
                conn = psycopg.connect(self.dsn, autocommit=True)
                log.info("connected to postgres (attempt %d)", attempt)
                return conn
            except Exception as exc:  # noqa: BLE001 - startup retry loop
                last_err = exc
                log.warning("postgres not ready (attempt %d/%d): %s", attempt, max_retries, exc)
                time.sleep(retry_delay)
        raise ConnectionError(f"could not connect to postgres at startup: {last_err}")

    # ------------------------------------------------------------------ #
    # Lookups
    # ------------------------------------------------------------------ #
    def _bfsi_sector(self) -> int:
        if self._bfsi_sector_id is None:
            with self._conn.cursor() as cur:
                cur.execute("SELECT sector_id FROM sectors WHERE sector_name = 'BFSI'")
                row = cur.fetchone()
                if not row:
                    raise RuntimeError("BFSI sector not found in sectors table")
                self._bfsi_sector_id = row[0]
        return self._bfsi_sector_id

    def _subsector_id(self, name: str) -> Optional[int]:
        with self._conn.cursor() as cur:
            cur.execute("SELECT subsector_id FROM subsectors WHERE subsector_name = %s", (name,))
            row = cur.fetchone()
            return row[0] if row else None

    def _metric_id(self, metric_key: str) -> int:
        if metric_key in self._metric_id_cache:
            return self._metric_id_cache[metric_key]
        with self._conn.cursor() as cur:
            cur.execute("SELECT metric_id FROM metric_definitions WHERE metric_key = %s", (metric_key,))
            row = cur.fetchone()
            if row is None:
                display_name, category, unit = _NEW_METRIC_DEFAULTS.get(
                    metric_key, (metric_key.replace("_", " ").title(), "Financial", "INR_CR")
                )
                cur.execute(
                    """INSERT INTO metric_definitions (metric_key, display_name, category, unit)
                       VALUES (%s, %s, %s, %s)
                       ON CONFLICT (metric_key) DO NOTHING
                       RETURNING metric_id""",
                    (metric_key, display_name, category, unit),
                )
                row = cur.fetchone()
                if row is None:  # lost an ON CONFLICT race -- re-select
                    cur.execute("SELECT metric_id FROM metric_definitions WHERE metric_key = %s", (metric_key,))
                    row = cur.fetchone()
                log.info("created new metric_definitions row for %r", metric_key)
        self._metric_id_cache[metric_key] = row[0]
        return row[0]

    def _state_id(self, state_name: str) -> Optional[int]:
        if not state_name or state_name.upper() == "N/A":
            return None
        with self._conn.cursor() as cur:
            cur.execute("SELECT state_id FROM states WHERE lower(state_name) = lower(%s)", (state_name,))
            row = cur.fetchone()
            return row[0] if row else None

    def find_organization(self, entity_name: str) -> Optional[str]:
        """Match against existing BFSI organizations by normalized legal
        name -- same dedupe key every other import in this platform uses.
        Only within BFSI: this pipeline's seed data (banks) never spans
        another sector, so there's no reason to risk a cross-sector
        false match."""
        target = normalize_for_dedup(entity_name)
        if not target:
            return None
        if self._org_name_cache is None:
            with self._conn.cursor() as cur:
                cur.execute(
                    """SELECT o.organization_id, o.legal_name FROM organizations o
                       JOIN sectors s ON s.sector_id = o.sector_id AND s.sector_name = 'BFSI'"""
                )
                self._org_name_cache = [(normalize_for_dedup(name), org_id) for org_id, name in cur.fetchall()]
        for norm_name, org_id in self._org_name_cache:
            if norm_name == target:
                return org_id
        return None

    # ------------------------------------------------------------------ #
    # Write
    # ------------------------------------------------------------------ #
    def exists(self, entity_id: str, entity_name: str) -> bool:
        return self.find_organization(entity_name) is not None

    def write(self, record: dict[str, Any], overwrite: bool) -> bool:
        """Finds or creates the matching organization, writes an address
        (state-level, headquarters) if it doesn't have one yet, and
        upserts every disclosed financial/technology metric via
        metric_definitions. Returns True if anything was actually
        written. A metric that's already on file and overwrite=False is
        left untouched -- same "never silently overwrite verified data"
        rule the Node backend's govt-finance backfill used."""
        entity_name = record["entity_name"]
        state = record.get("state") or record.get("detected_state")

        org_id = self.find_organization(entity_name)
        created_org = False
        with self._conn.cursor() as cur:
            if org_id is None:
                subsector_id = self._subsector_id("Non-Scheduled Urban Co-operative Bank") \
                    if record.get("entity_type") == "bank" else None
                cur.execute(
                    """INSERT INTO organizations (legal_name, sector_id, subsector_id, source_of_entry)
                       VALUES (%s, %s, %s, %s)
                       RETURNING organization_id""",
                    (entity_name, self._bfsi_sector(), subsector_id, "enrichment_pipeline"),
                )
                org_id = cur.fetchone()[0]
                created_org = True
                self._org_name_cache.append((normalize_for_dedup(entity_name), org_id))
                log.info("created new organization %s (%s)", entity_name, org_id)

            # Address: only add one if this org has no headquarters address
            # yet -- never invent a second HQ for an org that already has
            # real address data from an earlier import.
            state_id = self._state_id(state)
            if state_id is not None:
                cur.execute(
                    "SELECT 1 FROM addresses WHERE organization_id = %s AND is_headquarters", (org_id,)
                )
                if cur.fetchone() is None:
                    cur.execute(
                        """INSERT INTO addresses (organization_id, state_id, is_headquarters)
                           VALUES (%s, %s, true)""",
                        (org_id, state_id),
                    )

            wrote_any = created_org
            wrote_any |= self._upsert_metrics(cur, org_id, record, "financial_metrics", FINANCIAL_METRIC_FIELDS, overwrite)
            wrote_any |= self._upsert_metrics(cur, org_id, record, "technology_metrics", TECHNOLOGY_METRIC_FIELDS, overwrite)
            wrote_any |= self._update_address_line(cur, org_id, record, overwrite)
            wrote_any |= self._upsert_leadership(cur, org_id, record, overwrite)

        return wrote_any

    def _update_address_line(self, cur, org_id: str, record: dict[str, Any], overwrite: bool) -> bool:
        """Fills in the free-text address line on the org's existing HQ
        address row (created above from state alone) -- never creates a
        second address row, and never overwrites a real address already
        on file unless overwrite=True."""
        addr = record.get("head_office_address")
        if not addr or str(addr).strip().upper() == "N/A":
            return False
        cur.execute(
            "SELECT address_id, address_line FROM addresses WHERE organization_id = %s AND is_headquarters",
            (org_id,),
        )
        row = cur.fetchone()
        if row is None:
            # No HQ address row exists yet (state didn't resolve to a real
            # state_id) -- nothing to attach the address line to. Not an
            # error: this org just won't get an address this run.
            return False
        address_id, existing_line = row
        if existing_line and not overwrite:
            return False
        cur.execute("UPDATE addresses SET address_line = %s WHERE address_id = %s", (str(addr).strip(), address_id))
        return True

    def _upsert_leadership(self, cur, org_id: str, record: dict[str, Any], overwrite: bool) -> bool:
        incoming = {}
        for record_field, column in LEADERSHIP_COLUMNS.items():
            val = record.get(record_field)
            if val and str(val).strip() and str(val).strip().upper() != "N/A":
                incoming[column] = str(val).strip()
        if not incoming:
            return False

        cur.execute(
            "SELECT ceo_name, cto_name, cio_name, chairman_name FROM leadership_profiles WHERE organization_id = %s",
            (org_id,),
        )
        row = cur.fetchone()
        existing = dict(zip(("ceo_name", "cto_name", "cio_name", "chairman_name"), row)) if row else {}

        # Same "never silently overwrite verified data" rule as every
        # other field -- a column already filled stays put unless
        # overwrite=True, even if the other 3 columns on this row do get
        # new values this run.
        to_write = {c: v for c, v in incoming.items() if overwrite or not existing.get(c)}
        if not to_write:
            return False

        if row is None:
            columns = ", ".join(to_write.keys())
            placeholders = ", ".join(["%s"] * len(to_write))
            cur.execute(
                f"INSERT INTO leadership_profiles (organization_id, {columns}) VALUES (%s, {placeholders})",
                (org_id, *to_write.values()),
            )
        else:
            set_clause = ", ".join(f"{c} = %s" for c in to_write)
            cur.execute(
                f"UPDATE leadership_profiles SET {set_clause}, last_updated_at = now() WHERE organization_id = %s",
                (*to_write.values(), org_id),
            )
        return True

    def _upsert_metrics(
        self, cur, org_id: str, record: dict[str, Any], table: str,
        field_map: dict[str, str], overwrite: bool,
    ) -> bool:
        wrote_any = False
        for field, metric_key in field_map.items():
            value = _parse_money(record.get(field))
            if value is None:
                continue  # not disclosed -- write nothing, same "missing != zero" rule as ICP scoring
            metric_id = self._metric_id(metric_key)

            # Explicit check-then-act rather than ON CONFLICT: fiscal_year
            # is nullable and this pipeline never has a clean one to fill
            # in (extractor's financial_year is free text, not a smallint),
            # and Postgres's unique constraint treats every NULL as
            # distinct from every other NULL -- an ON CONFLICT on
            # (org, metric, fiscal_year) would silently never match a
            # second NULL-fiscal_year row and just keep inserting
            # duplicates on every re-run instead of updating.
            cur.execute(
                f"""SELECT 1 FROM {table}
                    WHERE organization_id = %s AND metric_id = %s AND fiscal_year IS NULL""",
                (org_id, metric_id),
            )
            existing = cur.fetchone()

            if existing is not None:
                if not overwrite:
                    continue
                cur.execute(
                    f"""UPDATE {table}
                           SET value = %s, source_citation = %s, source_url = %s, extracted_at = now()
                         WHERE organization_id = %s AND metric_id = %s AND fiscal_year IS NULL""",
                    (value, record.get("report_name"), record.get("source_url"), org_id, metric_id),
                )
            else:
                cur.execute(
                    f"""INSERT INTO {table} (organization_id, metric_id, value, source_citation, source_url)
                        VALUES (%s, %s, %s, %s, %s)""",
                    (org_id, metric_id, value, record.get("report_name"), record.get("source_url")),
                )
            wrote_any = True
        return wrote_any

    def close(self) -> None:
        try:
            self._conn.close()
        except Exception:  # noqa: BLE001
            pass
