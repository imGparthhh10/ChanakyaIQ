-- Industrial Clusters (Manufacturing) + Government Finance/Budget imports.
-- Additive only -- no existing column/table is altered destructively or dropped.
--
-- Why each piece exists:
--   1. financial_metrics/technology_metrics gained source_citation/source_url:
--      the govt finance sheet has real per-row provenance (Source Document,
--      Source URL, Verification Status) that doesn't fit `documents` --
--      Document.storage_path is NOT NULL (it models an actually-downloaded
--      file), and the same source article is cited by several department
--      rows in the same state, so forcing citations through it would be a
--      misuse of that table. confidence (already a column) covers
--      Verification Status; these two new nullable text columns cover the
--      rest without inventing a new join table for a single string pair.
--   2. rule_groups gained sector_id: score_models already had this column
--      (nullable, unused by any filtering logic today) but rule_groups never
--      did, and icp.service.ts applies every active rule_group/score_model
--      to every organization regardless of sector. That was invisible while
--      BFSI was the only populated sector; it stops being invisible the
--      moment a Government rule group exists, since Government's
--      allocated_budget/it_spend rules would otherwise also run against
--      every BFSI org (and vice versa: BFSI's Revenue/Net Profit rules
--      would run against Government orgs that were never scoped to have
--      those metrics). NULL sector_id keeps meaning "applies to every
--      sector" for forward compatibility, matching score_models' existing
--      convention -- both seeded rule groups below are pinned to a real
--      sector, not left NULL.
--   3. The Government rule group's threshold metric (allocated_budget) is
--      inserted into metric_definitions here rather than left to
--      resolveMetricDefinition()'s dynamic auto-create path, so the
--      qualification_rules/score_weights seed below has a real metric_id to
--      join against without an import-order dependency on the loader
--      having run first.

ALTER TABLE financial_metrics
  ADD COLUMN IF NOT EXISTS source_citation TEXT,
  ADD COLUMN IF NOT EXISTS source_url TEXT;

ALTER TABLE technology_metrics
  ADD COLUMN IF NOT EXISTS source_citation TEXT,
  ADD COLUMN IF NOT EXISTS source_url TEXT;

ALTER TABLE rule_groups
  ADD COLUMN IF NOT EXISTS sector_id SMALLINT REFERENCES sectors(sector_id);

-- Pin the existing BFSI group/model to BFSI explicitly -- today they're the
-- only rule group/score model in the system so this is a no-op in effect,
-- but it stops being a no-op the instant the Government group below exists.
UPDATE rule_groups
   SET sector_id = (SELECT sector_id FROM sectors WHERE sector_name = 'BFSI')
 WHERE group_name = 'BFSI Default Qualification' AND sector_id IS NULL;

UPDATE score_models
   SET sector_id = (SELECT sector_id FROM sectors WHERE sector_name = 'BFSI')
 WHERE model_name = 'BFSI Default ICP Model' AND sector_id IS NULL;

INSERT INTO metric_definitions (metric_key, display_name, category, unit)
VALUES ('allocated_budget', 'Allocated Budget', 'Financial', 'INR_CR')
ON CONFLICT (metric_key) DO NOTHING;

-- Government Default Qualification: Allocated Budget >= Rs.500 Cr OR
-- IT/Digital Spend >= Rs.5 Cr (ANY logic) -- BFSI's Revenue/Net
-- Profit/Cloud/Cybersecurity rules don't apply to a government department
-- (no such concept for a budget line item), so this is its own rule set
-- rather than a forced reuse, per the confirmed decision.
INSERT INTO rule_groups (group_name, match_logic, sector_id)
SELECT 'Government Default Qualification', 'ANY', sector_id
FROM sectors WHERE sector_name = 'Government'
ON CONFLICT DO NOTHING;

INSERT INTO qualification_rules (rule_group_id, metric_id, operator, threshold_value)
SELECT rg.rule_group_id, md.metric_id, v.operator, v.threshold
FROM rule_groups rg
JOIN (VALUES
    ('allocated_budget', '>=', 500.0),
    ('it_spend', '>=', 5.0)
) AS v(metric_key, operator, threshold) ON TRUE
JOIN metric_definitions md ON md.metric_key = v.metric_key
WHERE rg.group_name = 'Government Default Qualification'
  AND NOT EXISTS (
    SELECT 1 FROM qualification_rules qr
    WHERE qr.rule_group_id = rg.rule_group_id AND qr.metric_id = md.metric_id
  );

INSERT INTO score_models (model_name, sector_id)
SELECT 'Government Default ICP Model', sector_id
FROM sectors WHERE sector_name = 'Government'
ON CONFLICT DO NOTHING;

INSERT INTO score_weights (score_model_id, component_name, weight_pct)
SELECT sm.score_model_id, v.component_name, v.weight_pct
FROM score_models sm
JOIN (VALUES
    ('Allocated Budget', 60.0),
    ('IT/Digital Spend', 40.0)
) AS v(component_name, weight_pct) ON TRUE
WHERE sm.model_name = 'Government Default ICP Model'
  AND NOT EXISTS (
    SELECT 1 FROM score_weights sw
    WHERE sw.score_model_id = sm.score_model_id AND sw.component_name = v.component_name
  );
