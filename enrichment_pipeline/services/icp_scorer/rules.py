"""Rule-based ICP scoring engine. Deliberately NOT an LLM: qualification
must be a reproducible, auditable, config-driven function of the
extracted evidence, not a judgment call -- see config/scoring_rules.yaml
for the criteria and their weights.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

log = logging.getLogger("icp_scorer.rules")

NA = "N/A"
SPEND_FIELDS = [
    "it_spend_inr_cr", "data_centre_spend_inr_cr", "cybersecurity_spend_inr_cr",
    "cloud_spend_inr_cr", "digital_capex_inr_cr",
]


@dataclass
class ScoringConfig:
    threshold: float
    rules: list[dict[str, Any]]

    @classmethod
    def load(cls, path: str) -> "ScoringConfig":
        try:
            with open(path, "r", encoding="utf-8") as f:
                raw = yaml.safe_load(f) or {}
        except Exception as exc:  # noqa: BLE001 - fall back to safe defaults rather than crash
            log.error("failed to load scoring config from %s, using built-in defaults: %s", path, exc)
            return cls(threshold=40.0, rules=_DEFAULT_RULES)
        threshold = float(raw.get("qualification_threshold", 40.0))
        rules = raw.get("rules") or _DEFAULT_RULES
        return cls(threshold=threshold, rules=rules)


_DEFAULT_RULES: list[dict[str, Any]] = [
    {"id": "any_it_related_spend_disclosed", "points": 30},
    {"id": "revenue_disclosed_and_scoped", "points": 20},
    {"id": "revenue_above_minimum", "points": 15, "minimum_revenue_inr_cr": 25},
    {"id": "no_incumbent_vendor_mentioned", "points": 15},
    {"id": "state_match", "points": 10},
    {"id": "scale_signal_present", "points": 10},
]


def _is_real_value(v: Any) -> bool:
    return v is not None and str(v).strip().upper() != NA


def _to_float(v: Any) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def evaluate_rule(rule_id: str, rule_cfg: dict[str, Any], record: dict[str, Any]) -> bool:
    if rule_id == "any_it_related_spend_disclosed":
        return any(_is_real_value(record.get(f)) for f in SPEND_FIELDS)

    if rule_id == "revenue_disclosed_and_scoped":
        return _is_real_value(record.get("revenue_inr_cr")) and record.get("revenue_scope") in ("india", "state")

    if rule_id == "revenue_above_minimum":
        revenue = _to_float(record.get("revenue_inr_cr"))
        minimum = float(rule_cfg.get("minimum_revenue_inr_cr", 25))
        return revenue is not None and revenue >= minimum

    if rule_id == "no_incumbent_vendor_mentioned":
        vendors = record.get("mentioned_vendors") or []
        return len(vendors) == 0

    if rule_id == "state_match":
        state = (record.get("state") or "").strip().lower()
        # `state` on the record is the *seed* state (extractor doesn't
        # overwrite it), so this rule really checks that we have a real
        # state on file at all -- a record with no state can't be
        # confirmed to match anything.
        return bool(state) and state != "n/a"

    if rule_id == "scale_signal_present":
        return _is_real_value(record.get("branch_count")) or _is_real_value(record.get("employee_count"))

    log.warning("unknown rule id %r in scoring config, skipping (treated as not satisfied)", rule_id)
    return False


def score_record(record: dict[str, Any], config: ScoringConfig) -> tuple[float, dict[str, float], bool, str]:
    """Returns (score, breakdown, qualified, reason)."""
    breakdown: dict[str, float] = {}
    total = 0.0
    unmet: list[str] = []

    for rule in config.rules:
        rule_id = rule.get("id", "unknown_rule")
        points = float(rule.get("points", 0))
        try:
            satisfied = evaluate_rule(rule_id, rule, record)
        except Exception as exc:  # noqa: BLE001 - one bad rule must not crash scoring
            log.error("rule %r raised an exception, treating as not satisfied: %s", rule_id, exc)
            satisfied = False
        breakdown[rule_id] = points if satisfied else 0.0
        if satisfied:
            total += points
        else:
            unmet.append(rule_id)

    qualified = total >= config.threshold
    if qualified:
        reason = f"score {total:.0f} >= threshold {config.threshold:.0f}"
    else:
        reason = f"score {total:.0f} < threshold {config.threshold:.0f}; unmet rules: {', '.join(unmet) or 'none'}"
    return total, breakdown, qualified, reason


DEFAULT_CONFIG_PATH = str(Path(__file__).parent / "config" / "scoring_rules.yaml")
