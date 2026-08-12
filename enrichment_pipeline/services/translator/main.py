"""translator: consumes CrawledPayload from translate-jobs, detects the
language of every document (HTML text, or PDF via per-page extraction),
translates non-English content to English with IndicTrans2, and skips
translation entirely for content already in English. Publishes
TranslatedPayload to extract-jobs.

If the IndicTrans2 model can't be loaded (see indictrans.py), translation
degrades to a pass-through with a warning rather than crashing the
container -- extractor will then just find fewer/no matches for
non-English pages, which is honest ("N/A") rather than fabricated.
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

from indictrans import IndicTrans2Translator  # noqa: E402
from language import detect_language, flores_code_for  # noqa: E402
from pdf_text import extract_pdf_pages  # noqa: E402
from shared.logging_events import EventLogger  # noqa: E402
from shared.models import CrawledPayload, TranslatedDocument, TranslatedPayload  # noqa: E402
from shared.queue_client import QueueClient, StreamMessage  # noqa: E402

STAGE = "translator"
REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379/0")
TRANSLATE_JOBS_STREAM = os.environ.get("TRANSLATE_JOBS_STREAM", "translate-jobs")
EXTRACT_JOBS_STREAM = os.environ.get("EXTRACT_JOBS_STREAM", "extract-jobs")
GROUP = "translator"
BATCH_SIZE = int(os.environ.get("TRANSLATOR_BATCH_SIZE", "3"))
TRANSLATION_ENABLED = os.environ.get("TRANSLATION_ENABLED", "true").lower() != "false"


def translate_html_document(doc, translator: IndicTrans2Translator, evlog: EventLogger, job) -> TranslatedDocument:
    lang = detect_language(doc.text)
    flores = flores_code_for(lang) if lang != "en" else None
    if flores and TRANSLATION_ENABLED:
        english_text = translator.translate_document(doc.text, flores)
        was_translated = True
    else:
        english_text = doc.text
        was_translated = False
        if lang != "en" and lang not in ("en",) and flores is None:
            evlog.debug(
                f"document language {lang!r} has no IndicTrans2 mapping, leaving as-is",
                entity_id=job.entity_id, entity_name=job.entity_name,
            )
    return TranslatedDocument(
        url=doc.url, source_type=doc.source_type, source_tag=doc.source_tag,
        local_path=doc.local_path, detected_language=lang, was_translated=was_translated, text=english_text,
    )


def translate_pdf_document(doc, translator: IndicTrans2Translator, evlog: EventLogger, job) -> TranslatedDocument:
    if not doc.local_path or not Path(doc.local_path).exists():
        evlog.warning(f"PDF document has no readable local file: {doc.url}", entity_id=job.entity_id, entity_name=job.entity_name)
        return TranslatedDocument(
            url=doc.url, source_type=doc.source_type, source_tag=doc.source_tag,
            local_path=doc.local_path, detected_language="unknown", was_translated=False, text="", pages=[],
        )

    pages = extract_pdf_pages(doc.local_path)
    sample = " ".join(pages)[:2000]
    lang = detect_language(sample)
    flores = flores_code_for(lang) if lang != "en" else None

    if flores and TRANSLATION_ENABLED:
        translated_pages = [translator.translate_document(p, flores) for p in pages]
        was_translated = True
    else:
        translated_pages = pages
        was_translated = False

    return TranslatedDocument(
        url=doc.url, source_type=doc.source_type, source_tag=doc.source_tag,
        local_path=doc.local_path, detected_language=lang, was_translated=was_translated,
        text=" ".join(translated_pages), pages=translated_pages,
    )


def process_job(payload: CrawledPayload, translator: IndicTrans2Translator, evlog: EventLogger) -> TranslatedPayload:
    translated_docs: list[TranslatedDocument] = []
    for doc in payload.documents:
        try:
            if doc.source_type == "pdf":
                translated_docs.append(translate_pdf_document(doc, translator, evlog, payload))
            else:
                translated_docs.append(translate_html_document(doc, translator, evlog, payload))
        except Exception as exc:  # noqa: BLE001 - one bad document must not lose the rest of the entity
            evlog.error(
                f"failed to translate document {doc.url}: {exc}",
                entity_id=payload.entity_id, entity_name=payload.entity_name,
            )
            continue

    return TranslatedPayload(
        entity_id=payload.entity_id, entity_name=payload.entity_name, entity_type=payload.entity_type,
        state=payload.state, sector=payload.sector, documents=translated_docs,
        found_nothing=payload.found_nothing or len(translated_docs) == 0,
    )


def handle_message(msg: StreamMessage, translator: IndicTrans2Translator, queue: QueueClient, evlog: EventLogger) -> None:
    if "__decode_error__" in msg.data:
        evlog.error("undecodable message on translate-jobs, dead-lettering", details={"raw": msg.data})
        queue.dead_letter(TRANSLATE_JOBS_STREAM, GROUP, msg.id, msg.data, attempts=1, last_error="json decode error")
        queue.ack(TRANSLATE_JOBS_STREAM, GROUP, msg.id)
        return

    try:
        payload = CrawledPayload.model_validate(msg.data)
    except ValidationError as exc:
        evlog.error(f"invalid CrawledPayload, dead-lettering: {exc}", details={"raw": msg.data})
        queue.dead_letter(TRANSLATE_JOBS_STREAM, GROUP, msg.id, msg.data, attempts=1, last_error=str(exc))
        queue.ack(TRANSLATE_JOBS_STREAM, GROUP, msg.id)
        return

    try:
        result = process_job(payload, translator, evlog)
        queue.publish(EXTRACT_JOBS_STREAM, result.model_dump())
        queue.ack(TRANSLATE_JOBS_STREAM, GROUP, msg.id)
        evlog.info(
            f"translated {payload.entity_name}: {len(result.documents)} document(s)",
            entity_id=payload.entity_id, entity_name=payload.entity_name,
        )
    except Exception as exc:  # noqa: BLE001 - never crash the consumer loop
        evlog.error(
            f"translation failed for {payload.entity_name}, leaving un-acked for orchestrator retry/dead-letter: {exc}",
            entity_id=payload.entity_id, entity_name=payload.entity_name,
        )


def main() -> None:
    queue = QueueClient(REDIS_URL, consumer_name="translator")
    evlog = EventLogger(STAGE, queue)
    queue.ensure_group(TRANSLATE_JOBS_STREAM, GROUP)
    translator = IndicTrans2Translator()
    evlog.info("translator starting", translation_enabled=TRANSLATION_ENABLED)

    while True:
        try:
            messages = queue.read_group(TRANSLATE_JOBS_STREAM, GROUP, count=BATCH_SIZE, block_ms=5000)
        except Exception as exc:  # noqa: BLE001 - transient redis hiccups must not kill the container
            evlog.error(f"failed to read from {TRANSLATE_JOBS_STREAM}: {exc}")
            time.sleep(3.0)
            continue

        for msg in messages:
            handle_message(msg, translator, queue, evlog)


if __name__ == "__main__":
    main()
