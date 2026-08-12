-- Business Intent Engine (MEDDPICC-derived qualification, scoring, and
-- soft-delete cleanup). Additive only -- no existing column/table is
-- altered or dropped.
--
-- Two deviations from how this was originally specced, both verified
-- against the actual schema rather than assumed:
--   1. business_intent_classification is a real Postgres enum, matching
--      this schema's own convention for every other closed-vocabulary
--      column (org_status, opportunity_tier, ...) rather than a TEXT +
--      CHECK constraint.
--   2. Cleanup (see the Node service code, not this file) soft-deletes by
--      setting organizations.status = 'REJECTED' -- a value that already
--      exists in org_status today -- instead of a hard DELETE. No
--      cascading deletes happen as a result of this feature; nothing here
--      changes any existing FK's ON DELETE behavior.

CREATE TYPE business_intent_classification AS ENUM (
  'Qualified',
  'Watch',
  'Not Qualified',
  'Not Scored'
);

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS business_intent_score INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS business_intent_classification business_intent_classification NOT NULL DEFAULT 'Not Scored',
  ADD COLUMN IF NOT EXISTS letters_matched TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS final_priority TEXT,
  ADD COLUMN IF NOT EXISTS business_intent_last_scored_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_org_business_intent_classification
  ON organizations (business_intent_classification);

CREATE TABLE IF NOT EXISTS business_intent_score_history (
    business_intent_score_history_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
    score INT NOT NULL,
    classification business_intent_classification NOT NULL,
    letters_matched TEXT[] NOT NULL DEFAULT '{}',
    scored_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bi_score_history_org_time
  ON business_intent_score_history (organization_id, scored_at DESC);

-- organization_id is a real FK (not a bare UUID as originally drafted)
-- because cleanup soft-deletes via status='REJECTED' rather than a hard
-- DELETE -- the referenced row still exists, so referential integrity is
-- both possible and worth enforcing. ON DELETE NoAction: this log must
-- never silently disappear even if an org row were ever purged by some
-- separate, future hard-delete process.
CREATE TABLE IF NOT EXISTS business_intent_removal_log (
    business_intent_removal_log_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(organization_id),
    organization_name TEXT NOT NULL,
    business_intent_score INT NOT NULL,
    business_intent_classification business_intent_classification NOT NULL,
    icp_score NUMERIC(5, 2),
    icp_tier opportunity_tier,
    reason TEXT NOT NULL,
    removed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bi_removal_log_org
  ON business_intent_removal_log (organization_id, removed_at DESC);
