"""Materiality thresholds for timeline events -- documented here, all configurable via
Settings (never hardcoded inline in diff.py), per spec: "Only emit an event on a material
change -- define and document the thresholds."

- revenue_change: percentage change in reported revenue (INR Cr) vs. the previously stored
  value. Default 10% -- small quarter-to-quarter estimate revisions are noise; a double-digit
  swing is a real signal worth surfacing on a timeline.
- ceo_change / technology_change / cloud_adoption / new_partnership / new_award / ai_initiative:
  binary presence/absence diffs -- any of these appearing for the first time (or a named
  individual changing) is inherently material; there's no "small" version of a new CEO.
- expansion: any increase in branch_count vs. the previous count. Even a small increase is a
  concrete, verifiable fact (not an estimate like revenue), so no percentage threshold is
  applied -- the material bar is simply "did it increase at all."
- hiring_spike: count of hiring_signal items mentioned in a single extraction reaching the
  configured threshold (default 5). This counts mentions *within one document's extraction*,
  not a true time-series hiring rate (the pipeline has no headcount time series) -- a documented
  proxy, not a precise measurement.
"""

from __future__ import annotations

REVENUE_CHANGE_PCT_DEFAULT = 10.0
HIRING_SPIKE_COUNT_DEFAULT = 5
