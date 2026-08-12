from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel

from pipeline.processing.chunking import Chunk


class ProcessingResult(BaseModel):
    model_config = {"arbitrary_types_allowed": True}

    document_id: UUID
    is_scanned: bool | None
    extracted: bool
    """True once OCR/native extraction produced *any* raw text, independent of whether it later
    passed the quality gate -- drives the OCR_DONE vs OCR_PENDING status decision."""
    detected_language: str | None
    translated: bool
    translated_text: str | None = None
    chunks: list[Chunk] = []
    passed_quality_check: bool
    reason: str | None = None
    """Why quality validation failed, when passed_quality_check is False."""
