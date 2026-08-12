from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from pydantic import BaseModel

from pipeline.enums import DocumentType


@dataclass(frozen=True)
class FetchedDocument:
    """What a DocumentFetcher hands back — engine.py turns this into DB rows + a stored file."""

    url: str
    final_url: str
    content: bytes
    content_type: str | None
    status_code: int


class CrawlSourceRow(BaseModel):
    """A row read back from crawl_sources — what collection actually iterates over."""

    crawl_source_id: UUID
    organization_id: UUID
    source_type: DocumentType
    url: str


class CollectionOutcome(BaseModel):
    source_url: str
    crawl_job_id: UUID
    succeeded: bool
    document_id: UUID | None = None
    is_new_version: bool = False
    skipped_unchanged: bool = False
    error_message: str | None = None
