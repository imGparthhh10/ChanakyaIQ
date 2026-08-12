from __future__ import annotations

from pipeline.profile.merge import should_replace


def test_no_prior_value_always_replaces() -> None:
    assert should_replace(None, 0.0) is True
    assert should_replace(None, 99.0) is True


def test_higher_or_equal_confidence_replaces() -> None:
    assert should_replace(50.0, 50.0) is True
    assert should_replace(50.0, 80.0) is True


def test_lower_confidence_does_not_replace() -> None:
    assert should_replace(80.0, 50.0) is False
