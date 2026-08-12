from __future__ import annotations

from pipeline.config import Settings
from pipeline.extraction.schema import ExtractedProfile, SourcedListItem, SourcedValue
from pipeline.timeline.diff import diff_profile
from pipeline.timeline.schema import PriorState


def make_settings(**overrides: object) -> Settings:
    return Settings(DATABASE_URL="postgresql://unused/unused", **overrides)  # type: ignore[arg-type]


def test_revenue_change_above_threshold_emits_event() -> None:
    prior = PriorState(latest_revenue_inr_cr=100.0)
    profile = ExtractedProfile(revenue_inr_cr=SourcedValue(value=150.0, confidence=90), overall_confidence=90)
    events = diff_profile(prior, profile, make_settings(PIPELINE_TL_REVENUE_PCT=10.0))
    assert any(e.event_type == "revenue_change" for e in events)


def test_revenue_change_below_threshold_no_event() -> None:
    prior = PriorState(latest_revenue_inr_cr=100.0)
    profile = ExtractedProfile(revenue_inr_cr=SourcedValue(value=103.0, confidence=90), overall_confidence=90)
    events = diff_profile(prior, profile, make_settings(PIPELINE_TL_REVENUE_PCT=10.0))
    assert not any(e.event_type == "revenue_change" for e in events)


def test_ceo_change_detected() -> None:
    prior = PriorState(ceo_name="Old CEO")
    profile = ExtractedProfile(ceo_name=SourcedValue(value="New CEO", confidence=90), overall_confidence=90)
    events = diff_profile(prior, profile, make_settings())
    ceo_events = [e for e in events if e.event_type == "ceo_change"]
    assert len(ceo_events) == 1
    assert ceo_events[0].old_value == "Old CEO"
    assert ceo_events[0].new_value == "New CEO"


def test_same_ceo_no_event() -> None:
    prior = PriorState(ceo_name="Same CEO")
    profile = ExtractedProfile(ceo_name=SourcedValue(value="Same CEO", confidence=90), overall_confidence=90)
    events = diff_profile(prior, profile, make_settings())
    assert not any(e.event_type == "ceo_change" for e in events)


def test_expansion_only_on_increase() -> None:
    prior = PriorState(branch_count=50)
    grew = ExtractedProfile(branch_count=SourcedValue(value=60, confidence=90), overall_confidence=90)
    shrank = ExtractedProfile(branch_count=SourcedValue(value=40, confidence=90), overall_confidence=90)
    assert any(e.event_type == "expansion" for e in diff_profile(prior, grew, make_settings()))
    assert not any(e.event_type == "expansion" for e in diff_profile(prior, shrank, make_settings()))


def test_hiring_spike_threshold() -> None:
    settings = make_settings(PIPELINE_TL_HIRING_COUNT=3)
    few = ExtractedProfile(hiring_signals=[SourcedListItem(value="role A", confidence=80)], overall_confidence=90)
    many = ExtractedProfile(
        hiring_signals=[SourcedListItem(value=f"role {i}", confidence=80) for i in range(5)], overall_confidence=90
    )
    assert not any(e.event_type == "hiring_spike" for e in diff_profile(PriorState(), few, settings))
    assert any(e.event_type == "hiring_spike" for e in diff_profile(PriorState(), many, settings))


def test_new_partnership_diffed_against_prior() -> None:
    prior = PriorState(partnerships={"Existing Partner"})
    profile = ExtractedProfile(
        partnerships=[
            SourcedListItem(value="Existing Partner", confidence=80),
            SourcedListItem(value="Brand New Partner", confidence=80),
        ],
        overall_confidence=90,
    )
    events = diff_profile(prior, profile, make_settings())
    new_partnership_events = [e for e in events if e.event_type == "new_partnership"]
    assert len(new_partnership_events) == 1
    assert new_partnership_events[0].new_value == "Brand New Partner"


def test_no_prior_data_emits_no_diff_events() -> None:
    """No prior revenue/ceo/branch data to diff against -- nothing material can be claimed."""
    profile = ExtractedProfile(
        revenue_inr_cr=SourcedValue(value=100.0, confidence=90),
        ceo_name=SourcedValue(value="Someone", confidence=90),
        branch_count=SourcedValue(value=10, confidence=90),
        overall_confidence=90,
    )
    events = diff_profile(PriorState(), profile, make_settings())
    assert not any(e.event_type in ("revenue_change", "ceo_change", "expansion") for e in events)
