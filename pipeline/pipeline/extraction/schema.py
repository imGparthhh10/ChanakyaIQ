"""The strictly validated extraction schema (pydantic). Confidence is 0-100 throughout, matching
the DB's own convention for every confidence column (financial_metrics.confidence,
technology_metrics.confidence, leadership.confidence, timeline_events.confidence,
organizations.confidence_score, enrichment_jobs.confidence_score are all NUMERIC(5,2)) --
this schema is not inventing a new scale.

`source_chunk_index` is the model's own citation of which chunk it read a fact from -- the
document_id half of the citation is supplied by the engine at persist time (it already knows
which document is being processed; asking the model to echo back a UUID it never saw would
just be another way to fabricate data).
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class SourcedValue(BaseModel):
    value: str | float | int | None = None
    confidence: float = Field(default=0.0, ge=0, le=100)
    source_chunk_index: int | None = None


class SourcedListItem(BaseModel):
    value: str
    confidence: float = Field(ge=0, le=100)
    source_chunk_index: int | None = None


class ContactDetail(BaseModel):
    channel: str  # Email | Phone | LinkedIn | Twitter/X | Other -- matches ContactChannel enum
    value: str
    confidence: float = Field(ge=0, le=100)
    source_chunk_index: int | None = None


class ExtractedProfile(BaseModel):
    company_summary: SourcedValue | None = None
    fiscal_year: SourcedValue | None = None
    """The fiscal year the financial figures below (revenue/net_profit/assets) refer to, e.g.
    2024 -- required for financial_metrics/technology_metrics to be persisted idempotently
    (see pipeline/profile/README note in merge.py); without it those figures are logged but
    not written, rather than guessed or written with an ambiguous NULL year."""
    revenue_inr_cr: SourcedValue | None = None
    net_profit_inr_cr: SourcedValue | None = None
    total_assets_inr_cr: SourcedValue | None = None
    branch_count: SourcedValue | None = None
    employee_count: SourcedValue | None = None
    headquarters: SourcedValue | None = None
    ceo_name: SourcedValue | None = None
    cio_name: SourcedValue | None = None
    cto_name: SourcedValue | None = None
    ciso_name: SourcedValue | None = None
    chairman_name: SourcedValue | None = None

    board_members: list[SourcedListItem] = Field(default_factory=list)
    products: list[SourcedListItem] = Field(default_factory=list)
    services: list[SourcedListItem] = Field(default_factory=list)
    technology_stack: list[SourcedListItem] = Field(default_factory=list)
    ai_projects: list[SourcedListItem] = Field(default_factory=list)
    cloud_projects: list[SourcedListItem] = Field(default_factory=list)
    cybersecurity_notes: list[SourcedListItem] = Field(default_factory=list)
    digital_initiatives: list[SourcedListItem] = Field(default_factory=list)
    awards: list[SourcedListItem] = Field(default_factory=list)
    partnerships: list[SourcedListItem] = Field(default_factory=list)
    certifications: list[SourcedListItem] = Field(default_factory=list)
    hiring_signals: list[SourcedListItem] = Field(default_factory=list)

    contacts: list[ContactDetail] = Field(default_factory=list)

    overall_confidence: float = Field(ge=0, le=100)
