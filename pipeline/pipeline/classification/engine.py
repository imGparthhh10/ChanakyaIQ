"""Stage 3 entry point. Re-classifies a document against its actual downloaded content, since
discovery's source_type was only ever a URL-pattern guess made before any content existed.
Below the confidence threshold, the original type is left untouched and a WARN is logged --
"emit a confidence; low confidence goes to review rather than a wrong label."
"""

from __future__ import annotations

from pathlib import Path
from uuid import UUID

from pipeline.classification.repository import (
    apply_document_type,
    load_documents_for_org,
    log_low_confidence,
)
from pipeline.classification.rules import best_classification, score_document_type
from pipeline.classification.schema import ClassificationResult
from pipeline.config import Settings
from pipeline.db.connection import get_connection
from pipeline.enums import DocumentType


def classify_document(
    *,
    document_id: UUID,
    original_type: DocumentType,
    url: str,
    storage_path: str,
    settings: Settings,
) -> ClassificationResult:
    content = Path(storage_path).read_bytes() if Path(storage_path).exists() else b""
    content_type = "text/html" if storage_path.endswith(".html") else None
    scores = score_document_type(url=url, content=content, content_type=content_type)
    classified_type, confidence = best_classification(scores)

    applied = classified_type is not None and confidence >= settings.classification_min_confidence
    return ClassificationResult(
        document_id=document_id,
        original_type=original_type,
        classified_type=classified_type,
        confidence=confidence,
        applied=applied,
    )


def classify_for_organization(organization_id: UUID, settings: Settings) -> list[ClassificationResult]:
    with get_connection(settings) as conn:
        documents = load_documents_for_org(conn, organization_id)

    results: list[ClassificationResult] = []
    for doc in documents:
        result = classify_document(
            document_id=doc["document_id"],
            original_type=DocumentType(doc["document_type"]),
            url=doc["url"] or "",
            storage_path=doc["storage_path"],
            settings=settings,
        )
        results.append(result)
        with get_connection(settings) as conn:
            if result.applied and result.classified_type is not None:
                apply_document_type(conn, doc["document_id"], str(result.classified_type))
            elif result.classified_type is not None:
                log_low_confidence(conn, organization_id, doc["document_id"], doc["url"] or "", result.confidence)
    return results
