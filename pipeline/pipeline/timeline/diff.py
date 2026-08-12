"""Pure diff logic -- PriorState + the newly extracted profile in, TimelineEventDrafts out.
No I/O, fully unit-testable. See thresholds.py for what "material" means for each event type.
"""

from __future__ import annotations

from pipeline.config import Settings
from pipeline.extraction.schema import ExtractedProfile
from pipeline.resolution.normalize import detect_cloud_providers, normalize_generic
from pipeline.timeline.schema import PriorState, TimelineEventDraft


def _new_items(prior: set[str], new_items: list) -> list:  # type: ignore[type-arg]
    prior_normalized = {normalize_generic(p) for p in prior}
    return [item for item in new_items if normalize_generic(item.value) not in prior_normalized]


def diff_profile(prior: PriorState, profile: ExtractedProfile, settings: Settings) -> list[TimelineEventDraft]:
    events: list[TimelineEventDraft] = []

    # Revenue change
    rev = profile.revenue_inr_cr
    if rev and rev.value is not None and prior.latest_revenue_inr_cr:
        old_v = prior.latest_revenue_inr_cr
        new_v = float(rev.value)
        pct_change = abs(new_v - old_v) / old_v * 100 if old_v else 0.0
        if pct_change >= settings.timeline_revenue_change_pct:
            events.append(TimelineEventDraft(
                event_type="revenue_change",
                event_summary=f"Revenue changed from ₹{old_v:,.1f} Cr to ₹{new_v:,.1f} Cr ({pct_change:.1f}%).",
                old_value=old_v, new_value=new_v, confidence=rev.confidence, source_chunk_index=rev.source_chunk_index,
            ))

    # CEO change
    ceo = profile.ceo_name
    if ceo and ceo.value and prior.ceo_name and normalize_generic(str(ceo.value)) != normalize_generic(prior.ceo_name):
        events.append(TimelineEventDraft(
            event_type="ceo_change",
            event_summary=f"CEO changed from {prior.ceo_name} to {ceo.value}.",
            old_value=prior.ceo_name, new_value=ceo.value, confidence=ceo.confidence, source_chunk_index=ceo.source_chunk_index,
        ))

    # Technology change -- any newly-seen technology_stack item
    for item in _new_items(prior.technology_stack, profile.technology_stack):
        events.append(TimelineEventDraft(
            event_type="technology_change", event_summary=f"New technology adopted: {item.value}.",
            old_value=None, new_value=item.value, confidence=item.confidence, source_chunk_index=item.source_chunk_index,
        ))

    # AI initiative -- any newly-seen ai_projects item
    for item in _new_items(prior.ai_projects, profile.ai_projects):
        events.append(TimelineEventDraft(
            event_type="ai_initiative", event_summary=f"New AI initiative: {item.value}.",
            old_value=None, new_value=item.value, confidence=item.confidence, source_chunk_index=item.source_chunk_index,
        ))

    # Cloud adoption -- new cloud provider mentioned in either technology_stack or cloud_projects
    seen_providers = set(prior.cloud_providers)
    for item in list(profile.technology_stack) + list(profile.cloud_projects):
        for provider in detect_cloud_providers(item.value):
            if provider not in seen_providers:
                events.append(TimelineEventDraft(
                    event_type="cloud_adoption", event_summary=f"Cloud adoption signal: {provider}.",
                    old_value=None, new_value=provider, confidence=item.confidence, source_chunk_index=item.source_chunk_index,
                ))
                seen_providers.add(provider)

    # New partnership
    for item in _new_items(prior.partnerships, profile.partnerships):
        events.append(TimelineEventDraft(
            event_type="new_partnership", event_summary=f"New partnership: {item.value}.",
            old_value=None, new_value=item.value, confidence=item.confidence, source_chunk_index=item.source_chunk_index,
        ))

    # New award
    for item in _new_items(prior.awards, profile.awards):
        events.append(TimelineEventDraft(
            event_type="new_award", event_summary=f"New award: {item.value}.",
            old_value=None, new_value=item.value, confidence=item.confidence, source_chunk_index=item.source_chunk_index,
        ))

    # Expansion -- branch_count increased at all
    branches = profile.branch_count
    if branches and branches.value is not None and prior.branch_count is not None:
        new_count = int(branches.value)
        if new_count > prior.branch_count:
            events.append(TimelineEventDraft(
                event_type="expansion",
                event_summary=f"Branch count increased from {prior.branch_count} to {new_count}.",
                old_value=prior.branch_count, new_value=new_count, confidence=branches.confidence,
                source_chunk_index=branches.source_chunk_index,
            ))

    # Hiring spike -- count of hiring_signal mentions in this one extraction
    if len(profile.hiring_signals) >= settings.timeline_hiring_spike_count:
        avg_confidence = sum(i.confidence for i in profile.hiring_signals) / len(profile.hiring_signals)
        events.append(TimelineEventDraft(
            event_type="hiring_spike",
            event_summary=f"{len(profile.hiring_signals)} hiring signals mentioned in one document "
            f"(threshold: {settings.timeline_hiring_spike_count}).",
            old_value=None, new_value=[i.value for i in profile.hiring_signals], confidence=avg_confidence,
        ))

    return events
