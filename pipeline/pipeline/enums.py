"""Mirrors of the Postgres enums defined in backend/prisma/schema.prisma.

These are the pipeline's vocabulary — never invent a new string outside these sets. Each
member's `.value` is the exact literal stored in Postgres (the Prisma `@map(...)` value where
one exists), so `str(SomeEnum.MEMBER)` can be interpolated directly into a `%s::enum_type` cast.

Source of truth is the Prisma schema, not this file — if the schema changes, update here to
match, never the other way around (Prisma owns migrations; Python only reads and writes rows).
"""

from __future__ import annotations

from enum import StrEnum


class StrValueEnum(StrEnum):
    """enum.StrEnum (3.11+) already makes str(member) / f"{member}" / %s-formatting yield the
    raw `.value` -- no custom __str__ needed, unlike the older `class X(str, Enum)` pattern."""


class DocumentType(StrValueEnum):
    OFFICIAL_WEBSITE = "Official Website"
    INVESTOR_PAGE = "Investor Page"
    ANNUAL_REPORT = "Annual Report"
    AGM_REPORT = "AGM Report"
    FINANCIAL_STATEMENT = "Financial Statement"
    NEWS = "News"
    GOVERNMENT_WEBSITE = "Government Website"
    RBI_PUBLICATION = "RBI Publication"
    PRESS_RELEASE = "Press Release"
    SOCIAL_MEDIA = "Social Media"
    SUSTAINABILITY_CSR = "Sustainability/CSR"
    CAREER = "Career"
    OTHER = "Other"


class DocumentStatus(StrValueEnum):
    DOWNLOADED = "DOWNLOADED"
    FAILED = "FAILED"
    RETRYING = "RETRYING"
    OCR_PENDING = "OCR_PENDING"
    OCR_DONE = "OCR_DONE"
    PROCESSED = "PROCESSED"


class CrawlJobStatus(StrValueEnum):
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    SUCCESS = "SUCCESS"
    FAILED = "FAILED"
    RETRY = "RETRY"


class ExtractionStatus(StrValueEnum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    PASSED = "PASSED"
    FAILED = "FAILED"
    MANUAL_REVIEW = "MANUAL_REVIEW"


class OrgStatus(StrValueEnum):
    NEW = "NEW"
    PENDING = "PENDING"
    IMPORTING = "IMPORTING"
    DISCOVERING_SOURCES = "DISCOVERING_SOURCES"
    CRAWLING = "CRAWLING"
    DOCUMENTS_COLLECTED = "DOCUMENTS_COLLECTED"
    OCR_COMPLETE = "OCR_COMPLETE"
    TRANSLATED = "TRANSLATED"
    EXTRACTING = "EXTRACTING"
    ENTITY_RESOLUTION = "ENTITY_RESOLUTION"
    ENRICHED = "ENRICHED"
    ICP_RUNNING = "ICP_RUNNING"
    QUALIFIED = "QUALIFIED"
    ACTIVE = "ACTIVE"
    REVIEW_QUEUE = "REVIEW_QUEUE"
    REJECTED = "REJECTED"
    FAILED = "FAILED"


# The forward path this pipeline drives an organization through, stage by stage. PENDING and
# IMPORTING precede this (owned by the existing Excel import CLI, backend/src/modules/import) —
# an org handed to this pipeline is assumed already NEW or later, see judgment call #1 in
# pipeline/README.md.
ORG_STATUS_FORWARD_PATH: list[OrgStatus] = [
    OrgStatus.NEW,
    OrgStatus.DISCOVERING_SOURCES,
    OrgStatus.CRAWLING,
    OrgStatus.DOCUMENTS_COLLECTED,
    OrgStatus.OCR_COMPLETE,
    OrgStatus.TRANSLATED,
    OrgStatus.EXTRACTING,
    OrgStatus.ENTITY_RESOLUTION,
    OrgStatus.ENRICHED,
    OrgStatus.ICP_RUNNING,
]


class OwnershipType(StrValueEnum):
    GOVERNMENT = "Government"
    PRIVATE = "Private"
    COOPERATIVE = "Cooperative"
    PUBLIC_LISTED = "Public Listed"
    FOREIGN = "Foreign"
    OTHER = "Other"


class OpportunityTier(StrValueEnum):
    STRATEGIC = "Strategic"
    TIER_1 = "Tier 1"
    TIER_2 = "Tier 2"
    TIER_3 = "Tier 3"
    WATCHLIST = "Watchlist"


class ContactChannel(StrValueEnum):
    EMAIL = "Email"
    PHONE = "Phone"
    LINKEDIN = "LinkedIn"
    TWITTER_X = "Twitter/X"
    OTHER = "Other"


class LogLevel(StrValueEnum):
    """processing_logs.level has no DB enum (plain TEXT, default 'INFO') — this is the
    pipeline's own closed vocabulary for it, kept consistent across all stages."""

    DEBUG = "DEBUG"
    INFO = "INFO"
    WARN = "WARN"
    ERROR = "ERROR"
