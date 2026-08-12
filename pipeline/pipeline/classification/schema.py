from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel

from pipeline.enums import DocumentType


class ClassificationResult(BaseModel):
    document_id: UUID
    original_type: DocumentType
    classified_type: DocumentType | None
    confidence: float
    applied: bool
    """True if classified_type replaced original_type (confidence met the threshold)."""
