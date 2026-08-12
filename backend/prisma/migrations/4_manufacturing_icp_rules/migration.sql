-- Manufacturing ICP rule group + score model.
-- Additive only -- no existing column/table is altered or dropped.
--
-- Why this is Revenue-only, unlike BFSI's 5 rules / 7 weighted components:
--   Queried the real financial_metrics/technology_metrics coverage across
--   all 552 Manufacturing organizations before writing this. Revenue is on
--   file for 42 of them (7.6%); every other metric (net_profit, it_spend,
--   cloud_spend, cybersecurity_spend, employee_count, branch_count, ...) is
--   on file for at most 1-2 orgs (<0.4%), and leadership/contacts are
--   essentially absent too (2 and 0 orgs respectively). The Industrial
--   Clusters source file simply never carried those columns for most rows.
--   A qualification rule or score-weight component against a field that's
--   populated for <1% of the sector wouldn't be evaluating real signal --
--   it would be silently vacuous for 99%+ of orgs, which is the exact
--   "hide data-sparse orgs" problem this platform already had to solve
--   once (see filters.js's hasMinimumData). So: one rule, one component,
--   both Revenue, reflecting what this sector's import actually contains.
--
-- Threshold (revenue >= 1000 Cr) intentionally matches BFSI's existing bar
-- for cross-sector consistency in what "enterprise scale" means on this
-- platform, rather than picking a Manufacturing-specific number. Excludes
-- 1 of the 42 orgs with disclosed revenue (the ~Rs.580 Cr one); the other 41
-- clear it. The other 509 orgs (no revenue on file at all) fall through as
-- not-qualified via the same vacuous-truth guard already used for
-- Government/BFSI (icp.service.ts: evaluatedRules.length === 0 => false),
-- not as a false "failed the threshold".
--
-- Weighted score: Revenue is the sole component at 100% weight, using the
-- same percentile-rank-within-sector normalization as every other sector.
-- Organization Scale / Leadership & Contact Availability are deliberately
-- NOT included here (unlike BFSI's 10%/5%) since employee_count/branch_count
-- metrics and leadership data are populated for a negligible fraction of
-- this sector -- including them would score 0 for ~99.6% of orgs on data
-- that was never going to exist, dragging every score down for absence
-- rather than weakness.

INSERT INTO rule_groups (group_name, match_logic, sector_id)
SELECT 'Manufacturing Default Qualification', 'ANY', sector_id
FROM sectors WHERE sector_name = 'Manufacturing'
ON CONFLICT DO NOTHING;

INSERT INTO qualification_rules (rule_group_id, metric_id, operator, threshold_value)
SELECT rg.rule_group_id, md.metric_id, v.operator, v.threshold
FROM rule_groups rg
JOIN (VALUES
    ('revenue', '>=', 1000.0)
) AS v(metric_key, operator, threshold) ON TRUE
JOIN metric_definitions md ON md.metric_key = v.metric_key
WHERE rg.group_name = 'Manufacturing Default Qualification'
  AND NOT EXISTS (
    SELECT 1 FROM qualification_rules qr
    WHERE qr.rule_group_id = rg.rule_group_id AND qr.metric_id = md.metric_id
  );

INSERT INTO score_models (model_name, sector_id)
SELECT 'Manufacturing Default ICP Model', sector_id
FROM sectors WHERE sector_name = 'Manufacturing'
ON CONFLICT DO NOTHING;

INSERT INTO score_weights (score_model_id, component_name, weight_pct)
SELECT sm.score_model_id, v.component_name, v.weight_pct
FROM score_models sm
JOIN (VALUES
    ('Revenue', 100.0)
) AS v(component_name, weight_pct) ON TRUE
WHERE sm.model_name = 'Manufacturing Default ICP Model'
  AND NOT EXISTS (
    SELECT 1 FROM score_weights sw
    WHERE sw.score_model_id = sm.score_model_id AND sw.component_name = v.component_name
  );
