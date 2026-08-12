"""seed-loader: reads the input Excel/CSV of entities (bank name + state,
or company name + state) and pushes one SeedJob per row onto the
crawl-jobs stream. One-shot container -- it runs to completion and exits;
docker-compose gives it restart: "no" so it doesn't loop forever.

Supports:
  - .csv  (the RBI Non-Scheduled Urban Co-operative Banks list, as shipped
           in data/input/non_scheduled_urban_coop_banks.csv, columns:
           sr_no, bank_name, ro_name, head_office_address, pincode, state)
  - .xlsx (a generic company list with at least Name + State columns --
           column names are matched case-insensitively against a small
           set of aliases so "Company Name" / "Bank Name" / "Name" and
           "State" / "State Name" all work without configuration)

A bad row (missing name, unreadable file, wrong extension) is logged and
skipped -- it never crashes the loader or stops the rest of the file from
being processed.
"""
from __future__ import annotations

import csv
import glob
import os
import sys
import time
from pathlib import Path
from typing import Iterator, Optional

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

from shared.logging_events import EventLogger  # noqa: E402
from shared.models import SeedJob, make_entity_id  # noqa: E402
from shared.queue_client import QueueClient  # noqa: E402

STAGE = "seed_loader"
REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379/0")
INPUT_DIR = os.environ.get("INPUT_DIR", "/data/input")
CRAWL_JOBS_STREAM = os.environ.get("CRAWL_JOBS_STREAM", "crawl-jobs")
DEFAULT_ENTITY_TYPE = os.environ.get("DEFAULT_ENTITY_TYPE", "bank")
DEFAULT_SECTOR = os.environ.get("DEFAULT_SECTOR", "BFSI")
# docker-compose re-verifies `crawler`'s `service_completed_successfully`
# dependency on seed_loader by recreating (and re-running) seed_loader
# every time crawler itself is recreated -- without this guard that means
# every `docker compose up -d crawler` after the first silently
# re-publishes a full duplicate batch of jobs. Set FORCE_RESEED=true to
# intentionally reseed (e.g. after replacing the input file).
SEED_MARKER_KEY = "seed_loader:completed_marker"
FORCE_RESEED = os.environ.get("FORCE_RESEED", "false").lower() == "true"

NAME_ALIASES = {"bank_name", "company_name", "company", "name", "entity_name", "bank"}
STATE_ALIASES = {"state", "state_name", "state/ut", "region_state"}


def _read_csv_rows(path: Path) -> Iterator[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            yield {(k or "").strip().lower(): (v or "").strip() for k, v in row.items()}


def _read_xlsx_rows(path: Path) -> Iterator[dict[str, str]]:
    import openpyxl  # imported lazily -- only needed for .xlsx input

    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb.active
    rows_iter = ws.iter_rows(values_only=True)
    try:
        header = [str(h or "").strip().lower() for h in next(rows_iter)]
    except StopIteration:
        return
    for raw in rows_iter:
        if raw is None or all(c is None for c in raw):
            continue
        row = {header[i]: ("" if raw[i] is None else str(raw[i]).strip()) for i in range(min(len(header), len(raw)))}
        yield row


def _extract_name_state(row: dict[str, str]) -> tuple[Optional[str], Optional[str]]:
    name = None
    for key in NAME_ALIASES:
        if row.get(key):
            name = row[key]
            break
    state = None
    for key in STATE_ALIASES:
        if row.get(key):
            state = row[key]
            break
    return name, state


def _iter_seed_jobs(path: Path, evlog: EventLogger) -> Iterator[SeedJob]:
    suffix = path.suffix.lower()
    if suffix == ".csv":
        rows = _read_csv_rows(path)
    elif suffix in (".xlsx", ".xlsm"):
        rows = _read_xlsx_rows(path)
    else:
        evlog.warning(f"skipping unsupported file type: {path.name}")
        return

    row_num = 1
    for row in rows:
        row_num += 1
        try:
            name, state = _extract_name_state(row)
            if not name:
                evlog.warning(f"{path.name}:row {row_num} has no recognizable name column, skipping", details={"row": row})
                continue
            state = state or "N/A"
            job = SeedJob(
                entity_id=make_entity_id(name, state),
                entity_name=name,
                entity_type=DEFAULT_ENTITY_TYPE,  # type: ignore[arg-type]
                state=state,
                ro_name=row.get("ro_name", "N/A") or "N/A",
                head_office_address=row.get("head_office_address", "N/A") or "N/A",
                pincode=row.get("pincode", "N/A") or "N/A",
                sector=DEFAULT_SECTOR,
                source_list=path.name,
            )
            yield job
        except Exception as exc:  # noqa: BLE001 - one bad row must never stop the load
            evlog.error(f"{path.name}:row {row_num} failed to parse, skipping: {exc}", details={"row": row})
            continue


def main() -> None:
    queue = QueueClient(REDIS_URL, consumer_name="seed_loader")
    evlog = EventLogger(STAGE, queue)

    if FORCE_RESEED:
        queue.clear_claim(SEED_MARKER_KEY)
    if not queue.try_claim_once(SEED_MARKER_KEY):
        evlog.info(
            "seed_loader already completed a run for this Redis instance -- skipping to avoid "
            "duplicate jobs (set FORCE_RESEED=true to reseed intentionally)"
        )
        queue.close()
        return

    evlog.info("seed_loader starting", input_dir=INPUT_DIR)

    input_dir = Path(INPUT_DIR)
    if not input_dir.exists():
        evlog.error(f"input dir {INPUT_DIR} does not exist -- nothing to load")
        return

    candidates = sorted(
        [Path(p) for p in glob.glob(str(input_dir / "*.csv"))]
        + [Path(p) for p in glob.glob(str(input_dir / "*.xlsx"))]
        + [Path(p) for p in glob.glob(str(input_dir / "*.xlsm"))]
    )
    if not candidates:
        evlog.warning(f"no .csv/.xlsx/.xlsm files found in {INPUT_DIR} -- nothing to load")
        return

    total_pushed = 0
    total_skipped = 0
    seen_ids: set[str] = set()
    start = time.time()

    for path in candidates:
        evlog.info(f"loading {path.name}")
        file_pushed = 0
        for job in _iter_seed_jobs(path, evlog):
            if job.entity_id in seen_ids:
                total_skipped += 1
                continue
            seen_ids.add(job.entity_id)
            try:
                queue.publish(CRAWL_JOBS_STREAM, job.model_dump())
                file_pushed += 1
                total_pushed += 1
            except Exception as exc:  # noqa: BLE001
                evlog.error(f"failed to publish job for {job.entity_name}: {exc}", entity_id=job.entity_id, entity_name=job.entity_name)
                total_skipped += 1
        evlog.info(f"loaded {path.name}: {file_pushed} jobs pushed")

    elapsed = round(time.time() - start, 2)
    evlog.info(
        f"seed_loader done: {total_pushed} jobs pushed, {total_skipped} rows skipped, {elapsed}s",
        pushed=total_pushed, skipped=total_skipped, elapsed_s=elapsed,
    )
    queue.close()


if __name__ == "__main__":
    main()
