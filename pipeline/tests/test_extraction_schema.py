from __future__ import annotations

import pytest
from pydantic import ValidationError

from pipeline.extraction.schema import ExtractedProfile


def test_minimal_valid_profile() -> None:
    profile = ExtractedProfile(overall_confidence=50)
    assert profile.revenue_inr_cr is None
    assert profile.board_members == []


def test_confidence_out_of_range_rejected() -> None:
    with pytest.raises(ValidationError):
        ExtractedProfile(overall_confidence=150)


def test_sourced_list_item_requires_value() -> None:
    with pytest.raises(ValidationError):
        ExtractedProfile.model_validate({"overall_confidence": 50, "board_members": [{"confidence": 80}]})


def test_full_profile_round_trips_through_json() -> None:
    profile = ExtractedProfile.model_validate(
        {
            "overall_confidence": 88,
            "revenue_inr_cr": {"value": 500.0, "confidence": 90, "source_chunk_index": 2},
            "board_members": [{"value": "Jane Doe", "confidence": 85, "source_chunk_index": 1}],
            "contacts": [{"channel": "Email", "value": "info@bank.co.in", "confidence": 70}],
        }
    )
    dumped = profile.model_dump(mode="json")
    reloaded = ExtractedProfile.model_validate(dumped)
    assert reloaded == profile
