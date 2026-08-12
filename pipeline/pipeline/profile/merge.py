"""The merge policy, in one place: "higher-confidence and more-recent data wins." Every field
this pipeline writes is from the newest extraction being processed right now, so "more recent"
is automatically satisfied by the act of processing it -- the only real decision is whether the
new value's confidence clears the bar set by whatever's already stored.

Missing prior confidence (nothing stored yet) always loses to *any* new value -- there's nothing
to protect.
"""

from __future__ import annotations


def should_replace(old_confidence: float | None, new_confidence: float) -> bool:
    return old_confidence is None or new_confidence >= old_confidence
