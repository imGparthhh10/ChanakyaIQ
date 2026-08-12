"""Pydantic job-payload models shared by every pipeline stage.

Every message that goes onto a Redis Stream is the JSON of one of these
models. Each consumer validates the raw payload against its expected model
*before* doing any work -- a payload that fails validation is logged and
dead-lettered immediately, never processed and never allowed to crash the
consumer loop.
"""
from __future__ import annotations

import hashlib
import re
import time
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

EntityType = Literal["bank", "company"]
SourceType = Literal["html", "pdf"]
RevenueScope = Literal["india", "state", "global", "unknown"]


def make_entity_id(name: str, state: str) -> str:
    """Deterministic id so the same entity always maps to the same id,
    across re-runs, without a central sequence generator."""
    key = f"{name.strip().lower()}|{state.strip().lower()}"
    return hashlib.sha1(key.encode("utf-8")).hexdigest()[:16]


class SeedJob(BaseModel):
    """One entity to enrich, produced by seed-loader, consumed by crawler."""

    entity_id: str
    entity_name: str
    entity_type: EntityType = "bank"
    state: str = "N/A"
    ro_name: str = "N/A"
    head_office_address: str = "N/A"
    pincode: str = "N/A"
    sector: str = "BFSI"
    source_list: str = "N/A"
    created_at: float = Field(default_factory=time.time)

    @field_validator("entity_name")
    @classmethod
    def _name_not_blank(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("entity_name must not be blank")
        return v.strip()

    @classmethod
    def from_row(cls, name: str, state: str, **extra) -> "SeedJob":
        return cls(entity_id=make_entity_id(name, state), entity_name=name, state=state, **extra)


class FetchedDocument(BaseModel):
    """One fetched page or PDF found for an entity."""

    url: str
    source_type: SourceType
    source_tag: str = "unknown"  # e.g. official_site, rbi, nabard, bse, nse, mca, financial_provider
    local_path: Optional[str] = None  # set for PDFs saved to the shared /data/raw volume
    text: str = ""  # extracted plain text (HTML) or empty for PDFs (extractor reads local_path)
    fetched_at: float = Field(default_factory=time.time)


class CrawledPayload(BaseModel):
    """Output of crawler, input to translator. One entity, N documents."""

    entity_id: str
    entity_name: str
    entity_type: EntityType = "bank"
    state: str = "N/A"
    sector: str = "BFSI"
    documents: list[FetchedDocument] = Field(default_factory=list)
    search_queries_tried: list[str] = Field(default_factory=list)
    attempt: int = 1
    found_nothing: bool = False
    notes: str = ""


class TranslatedDocument(BaseModel):
    url: str
    source_type: SourceType
    source_tag: str = "unknown"
    local_path: Optional[str] = None
    detected_language: str = "en"
    was_translated: bool = False
    text: str = ""  # English text (post-translation, or original if already English)
    # For PDFs only: per-page English text, 1 entry per PDF page, in order
    # (index 0 = page 1). This is how page numbers survive from the PDF
    # into the extractor's field citations without re-parsing the PDF.
    pages: list[str] = Field(default_factory=list)


class TranslatedPayload(BaseModel):
    """Output of translator, input to extractor."""

    entity_id: str
    entity_name: str
    entity_type: EntityType = "bank"
    state: str = "N/A"
    sector: str = "BFSI"
    documents: list[TranslatedDocument] = Field(default_factory=list)
    found_nothing: bool = False


MoneyField = str  # numeric string in INR Cr, or the literal "N/A"


class ExtractedRecord(BaseModel):
    """Output of extractor, input to icp-scorer. One record per entity
    (best evidence merged across all its fetched documents)."""

    entity_id: str
    entity_name: str
    entity_type: EntityType = "bank"
    state: str = "N/A"
    sector: str = "BFSI"

    financial_year: str = "N/A"
    report_name: str = "N/A"
    source_url: str = "N/A"
    page_number: str = "N/A"

    detected_state: str = "N/A"  # state mentioned near the citation evidence, independent of the seed's state

    revenue_inr_cr: MoneyField = "N/A"
    revenue_scope: RevenueScope = "unknown"
    it_spend_inr_cr: MoneyField = "N/A"
    data_centre_spend_inr_cr: MoneyField = "N/A"
    cybersecurity_spend_inr_cr: MoneyField = "N/A"
    cloud_spend_inr_cr: MoneyField = "N/A"
    digital_capex_inr_cr: MoneyField = "N/A"

    branch_count: str = "N/A"
    employee_count: str = "N/A"
    mentioned_vendors: list[str] = Field(default_factory=list)

    raw_snippet: str = "N/A"
    found_nothing: bool = False


class ScoredRecord(ExtractedRecord):
    """Output of icp-scorer. Goes to write-jobs if qualified, else rejected."""

    icp_score: float = 0.0
    qualified: bool = False
    score_breakdown: dict[str, float] = Field(default_factory=dict)
    reason: str = ""


class RejectedRecord(BaseModel):
    entity_id: str
    entity_name: str
    stage: str
    reason: str
    details: dict = Field(default_factory=dict)
    rejected_at: float = Field(default_factory=time.time)


class LogEvent(BaseModel):
    stage: str
    level: Literal["debug", "info", "warning", "error"] = "info"
    entity_id: Optional[str] = None
    entity_name: Optional[str] = None
    message: str
    details: dict = Field(default_factory=dict)
    ts: float = Field(default_factory=time.time)


class DeadLetterEnvelope(BaseModel):
    original_stream: str
    original_group: str
    original_id: str
    payload: dict
    attempts: int
    last_error: str
    moved_at: float = Field(default_factory=time.time)


_WS_RE = re.compile(r"\s+")


def clean_text(s: str) -> str:
    return _WS_RE.sub(" ", s or "").strip()
