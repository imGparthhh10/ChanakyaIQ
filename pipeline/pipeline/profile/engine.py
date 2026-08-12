"""Stage 8 entry point: merges one document's validated ExtractedProfile into the master
organization record. Gated per-document by overall_confidence (rule: "If overall confidence is
below the configured threshold, set status to REVIEW_QUEUE instead of overwriting good data") --
below threshold, nothing in this document's profile is written, full stop, and the caller is
told to route the org to REVIEW_QUEUE rather than advancing it normally.

Metric routing: financial_metrics vs technology_metrics is decided by metric_definitions.category
(the DB's own classification), not guessed here -- 'Financial' -> financial_metrics, everything
else (Technology/Workforce/Digital/Security/Other) -> technology_metrics, since those are the
only two metric-value tables that exist.
"""

from __future__ import annotations

from uuid import UUID

from pipeline.config import Settings
from pipeline.db.connection import get_connection
from pipeline.db.observability import log_processing
from pipeline.enums import ContactChannel, LogLevel
from pipeline.extraction.schema import ExtractedProfile, SourcedValue
from pipeline.profile.repository import (
    find_city_by_name,
    union_organization_profile_array,
    update_organization_summary,
    upsert_contact,
    upsert_financial_metric,
    upsert_headquarters_address,
    upsert_leadership,
    upsert_technology_metric,
    upsert_technology_profile_item,
)

_METRIC_FIELD_KEYS = {
    "revenue_inr_cr": "revenue",
    "net_profit_inr_cr": "net_profit",
    "total_assets_inr_cr": "total_assets",
    "employee_count": "employee_count",
    "branch_count": "branch_count",
}

_LEADERSHIP_FIELDS = {
    "ceo_name": ("CEO", "ceo_name"),
    "cto_name": ("CTO", "cto_name"),
    "cio_name": ("CIO", "cio_name"),
    "ciso_name": ("CISO", None),  # no leadership_profiles column for CISO
    "chairman_name": ("Chairman", "chairman_name"),
}


def _get_metric_category(conn, metric_key: str) -> str | None:  # type: ignore[no-untyped-def]
    row = conn.execute("SELECT category FROM metric_definitions WHERE metric_key = %s", (metric_key,)).fetchone()
    return str(row[0]) if row else None


class MergeSummary:
    def __init__(self) -> None:
        self.fields_written = 0
        self.gated_low_confidence = False


def merge_profile(
    organization_id: UUID, document_id: UUID, profile: ExtractedProfile, settings: Settings
) -> MergeSummary:
    summary = MergeSummary()

    if profile.overall_confidence < settings.profile_review_confidence_threshold:
        summary.gated_low_confidence = True
        with get_connection(settings) as conn:
            log_processing(
                conn, organization_id=organization_id, stage="PROFILE_MERGE",
                message=f"Document {document_id}: overall confidence {profile.overall_confidence:.1f} is "
                f"below the review threshold ({settings.profile_review_confidence_threshold}) -- "
                "not merging any fields from this extraction.",
                level=LogLevel.WARN,
            )
        return summary

    with get_connection(settings) as conn:
        fiscal_year = int(profile.fiscal_year.value) if profile.fiscal_year and profile.fiscal_year.value else None

        for field_name, metric_key in _METRIC_FIELD_KEYS.items():
            sv: SourcedValue | None = getattr(profile, field_name)
            if sv is None or sv.value is None:
                continue
            if fiscal_year is None:
                log_processing(
                    conn, organization_id=organization_id, stage="PROFILE_MERGE",
                    message=f"Skipping {metric_key}: no fiscal_year in this extraction, can't "
                    "upsert idempotently without one.",
                    level=LogLevel.WARN,
                )
                continue
            category = _get_metric_category(conn, metric_key)
            if category is None:
                continue  # metric not defined in this DB -- nothing to write against
            upsert_fn = upsert_financial_metric if category == "Financial" else upsert_technology_metric
            if upsert_fn(conn, organization_id, metric_key, fiscal_year, float(sv.value), sv.confidence, document_id):
                summary.fields_written += 1

        for field_name, (designation, profile_column) in _LEADERSHIP_FIELDS.items():
            sv = getattr(profile, field_name)
            if sv is None or not sv.value:
                continue
            if upsert_leadership(conn, organization_id, designation, str(sv.value), sv.confidence, document_id, profile_column):
                summary.fields_written += 1

        for field_name, category in (
            ("technology_stack", "technology_stack"), ("ai_projects", "ai_projects"),
            ("cloud_projects", "cloud_project"),
        ):
            for item in getattr(profile, field_name):
                if upsert_technology_profile_item(conn, organization_id, category, item.value, item.confidence, document_id):
                    summary.fields_written += 1

        for field_name, column in (
            ("products", "products"), ("services", "services"), ("awards", "awards"),
            ("partnerships", "partnerships"), ("digital_initiatives", "digital_initiatives"),
        ):
            items = [i.value for i in getattr(profile, field_name, [])]
            summary.fields_written += union_organization_profile_array(conn, organization_id, column, items)

        if profile.company_summary and profile.company_summary.value:
            update_organization_summary(conn, organization_id, str(profile.company_summary.value))
            summary.fields_written += 1

        for contact in profile.contacts:
            try:
                channel = ContactChannel(contact.channel).value
            except ValueError:
                channel = ContactChannel.OTHER.value
            if upsert_contact(conn, organization_id, channel, contact.value, document_id):
                summary.fields_written += 1

        if profile.headquarters and profile.headquarters.value:
            city = find_city_by_name(conn, str(profile.headquarters.value))
            if city:
                if upsert_headquarters_address(conn, organization_id, city["city_id"], city["state_id"]):
                    summary.fields_written += 1
            else:
                log_processing(
                    conn, organization_id=organization_id, stage="PROFILE_MERGE",
                    message=f"Headquarters '{profile.headquarters.value}' did not match any known city -- "
                    "address not written (never guessing a city_id).",
                    level=LogLevel.WARN,
                )

        log_processing(
            conn, organization_id=organization_id, stage="PROFILE_MERGE",
            message=f"Document {document_id}: {summary.fields_written} field(s) updated.",
            level=LogLevel.INFO,
        )

    return summary
