"""extractor: consumes TranslatedPayload from extract-jobs, runs rule-based
field extraction across every document belonging to an entity, merges the
best evidence into one ExtractedRecord, and publishes it to score-jobs.

Every monetary field is independently sourced -- the extractor searches
every document for each field separately and takes the first (highest
source-priority) document that has a usable, properly-scoped match. If no
document has a usable match for a field, that field is written as "N/A" ;
nothing is ever estimated or carried over from an unrelated field.
"""
from __future__ import annotations

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

from pydantic import ValidationError  # noqa: E402

import fields as F  # noqa: E402
from shared.logging_events import EventLogger  # noqa: E402
from shared.models import ExtractedRecord, TranslatedPayload, clean_text  # noqa: E402
from shared.queue_client import QueueClient, StreamMessage  # noqa: E402

STAGE = "extractor"
REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379/0")
EXTRACT_JOBS_STREAM = os.environ.get("EXTRACT_JOBS_STREAM", "extract-jobs")
SCORE_JOBS_STREAM = os.environ.get("SCORE_JOBS_STREAM", "score-jobs")
GROUP = "extractor"
BATCH_SIZE = int(os.environ.get("EXTRACTOR_BATCH_SIZE", "5"))

SPEND_FIELDS = [
    ("it_spend_inr_cr", F.IT_SPEND_KEYWORDS),
    ("data_centre_spend_inr_cr", F.DATA_CENTRE_KEYWORDS),
    ("cybersecurity_spend_inr_cr", F.CYBERSECURITY_KEYWORDS),
    ("cloud_spend_inr_cr", F.CLOUD_KEYWORDS),
    ("digital_capex_inr_cr", F.DIGITAL_CAPEX_KEYWORDS),
]


def _citation_for(doc, offset: int) -> str:
    if doc.source_type == "pdf" and doc.pages:
        page = F.page_number_for_offset(doc.pages, offset)
        return page
    return F.NA


def process_job(payload: TranslatedPayload, evlog: EventLogger) -> ExtractedRecord:
    record = ExtractedRecord(
        entity_id=payload.entity_id, entity_name=payload.entity_name, entity_type=payload.entity_type,
        state=payload.state, sector=payload.sector,
    )

    # Normalize whitespace once, up front. PDF pages are already
    # normalized by the translator (see translator/pdf_text.py), so this
    # is a no-op for them; for HTML documents it collapses whatever
    # irregular whitespace/newlines the source markup introduced -- every
    # keyword/regex match below assumes single-space-separated phrases,
    # so a phrase split across a line-wrap must not silently fail to match.
    for doc in payload.documents:
        doc.text = clean_text(doc.text)

    snippets: list[str] = []
    all_vendors: set[str] = set()
    fields_found = 0
    citation_doc = None
    citation_offset: int | None = None

    # Revenue: must be India- or state-scoped, never global, never guessed.
    for doc in payload.documents:
        if not doc.text:
            continue
        found = F.find_scoped_money(doc.text, F.REVENUE_KEYWORDS, payload.state)
        if found is None:
            continue
        money, scope = found
        record.revenue_inr_cr = str(money.value_inr_cr)
        record.revenue_scope = scope  # type: ignore[assignment]
        snippets.append(money.raw_text)
        fields_found += 1
        citation_doc, citation_offset = doc, money.span[0]
        break

    # Each spend field: independently sourced, first document that has it wins.
    for attr_name, keywords in SPEND_FIELDS:
        for doc in payload.documents:
            if not doc.text:
                continue
            match = F.find_spend_field(doc.text, keywords)
            if match is None:
                continue
            setattr(record, attr_name, str(match.value_inr_cr))
            snippets.append(match.raw_text)
            fields_found += 1
            if citation_doc is None:
                citation_doc, citation_offset = doc, match.span[0]
            break

    # Vendor mentions + branch/employee counts: scan every document, union results.
    for doc in payload.documents:
        if not doc.text:
            continue
        all_vendors.update(F.find_mentioned_vendors(doc.text))
        if record.branch_count == F.NA:
            bc = F.find_branch_count(doc.text)
            if bc != F.NA:
                record.branch_count = bc
        if record.employee_count == F.NA:
            ec = F.find_employee_count(doc.text)
            if ec != F.NA:
                record.employee_count = ec

    record.mentioned_vendors = sorted(all_vendors)

    # Citation fields (financial year / report name / source url / page
    # number) all anchor to whichever document first produced usable
    # evidence -- if nothing was found anywhere, they correctly stay N/A.
    if citation_doc is None:
        for doc in payload.documents:
            if doc.text:
                citation_doc = doc
                citation_offset = 0
                break

    if citation_doc is not None:
        record.source_url = citation_doc.url
        record.financial_year = F.find_financial_year(citation_doc.text)
        report_name = F.find_report_name(citation_doc.text)
        record.report_name = report_name if report_name != F.NA else f"{citation_doc.source_tag} document"
        record.page_number = _citation_for(citation_doc, citation_offset or 0)
        record.detected_state = F.detect_state_mention(citation_doc.text)

    record.raw_snippet = clean_text(" | ".join(snippets))[:1000] or F.NA
    record.found_nothing = payload.found_nothing or fields_found == 0
    return record


def handle_message(msg: StreamMessage, queue: QueueClient, evlog: EventLogger) -> None:
    if "__decode_error__" in msg.data:
        evlog.error("undecodable message on extract-jobs, dead-lettering", details={"raw": msg.data})
        queue.dead_letter(EXTRACT_JOBS_STREAM, GROUP, msg.id, msg.data, attempts=1, last_error="json decode error")
        queue.ack(EXTRACT_JOBS_STREAM, GROUP, msg.id)
        return

    try:
        payload = TranslatedPayload.model_validate(msg.data)
    except ValidationError as exc:
        evlog.error(f"invalid TranslatedPayload, dead-lettering: {exc}", details={"raw": msg.data})
        queue.dead_letter(EXTRACT_JOBS_STREAM, GROUP, msg.id, msg.data, attempts=1, last_error=str(exc))
        queue.ack(EXTRACT_JOBS_STREAM, GROUP, msg.id)
        return

    try:
        record = process_job(payload, evlog)
        queue.publish(SCORE_JOBS_STREAM, record.model_dump())
        queue.ack(EXTRACT_JOBS_STREAM, GROUP, msg.id)
        evlog.info(
            f"extracted {payload.entity_name}: revenue={record.revenue_inr_cr} it_spend={record.it_spend_inr_cr}",
            entity_id=payload.entity_id, entity_name=payload.entity_name,
        )
    except Exception as exc:  # noqa: BLE001 - never crash the consumer loop
        evlog.error(
            f"extraction failed for {payload.entity_name}, leaving un-acked for orchestrator retry/dead-letter: {exc}",
            entity_id=payload.entity_id, entity_name=payload.entity_name,
        )


def main() -> None:
    queue = QueueClient(REDIS_URL, consumer_name="extractor")
    evlog = EventLogger(STAGE, queue)
    queue.ensure_group(EXTRACT_JOBS_STREAM, GROUP)
    evlog.info("extractor starting")

    while True:
        try:
            messages = queue.read_group(EXTRACT_JOBS_STREAM, GROUP, count=BATCH_SIZE, block_ms=5000)
        except Exception as exc:  # noqa: BLE001 - transient redis hiccups must not kill the container
            evlog.error(f"failed to read from {EXTRACT_JOBS_STREAM}: {exc}")
            time.sleep(3.0)
            continue

        for msg in messages:
            handle_message(msg, queue, evlog)


if __name__ == "__main__":
    main()
