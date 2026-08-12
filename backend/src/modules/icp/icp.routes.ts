import { Router } from 'express';
import { z } from 'zod';
import { runIcpScoring } from './icp.service';
import { IcpRepository } from './icp.repository';
import { explainOpportunityTags } from './tags.service';
import { ApiError } from '../../middleware/errorHandler';

export const icpRoutes = Router();
const repo = new IcpRepository();

// Real rule evaluation + weighted scoring over already-imported data — not
// stubbed, no missing external dependency (unlike crawler/enrichment).
icpRoutes.post('/run', async (_req, res, next) => {
  try {
    const summary = await runIcpScoring();
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

// Stage 1: thresholds must be editable from the dashboard, not hardcoded —
// this is the admin surface for qualification_rules.threshold_value.
// Application code never hardcodes a threshold; it's always read from here.
icpRoutes.get('/rules', async (_req, res, next) => {
  try {
    const rules = await repo.listQualificationRules();
    res.json(
      rules.map((r) => ({
        ruleId: r.ruleId,
        ruleGroup: r.ruleGroup.groupName,
        matchLogic: r.ruleGroup.matchLogic,
        metricKey: r.metricDefinition.metricKey,
        metricDisplayName: r.metricDefinition.displayName,
        unit: r.metricDefinition.unit,
        operator: r.operator,
        thresholdValue: Number(r.thresholdValue),
        isActive: r.isActive,
      })),
    );
  } catch (err) {
    next(err);
  }
});

const UpdateThresholdSchema = z.object({ thresholdValue: z.number().positive() });

icpRoutes.patch('/rules/:ruleId', async (req, res, next) => {
  try {
    const { thresholdValue } = UpdateThresholdSchema.parse(req.body);
    const updated = await repo.updateRuleThreshold(req.params.ruleId, thresholdValue);
    res.json({
      ruleId: updated.ruleId,
      metricKey: updated.metricDefinition.metricKey,
      operator: updated.operator,
      thresholdValue: Number(updated.thresholdValue),
    });
  } catch (err) {
    next(err);
  }
});

export async function getOrgIcp(organizationId: string) {
  const [[qualification, score, tier], opportunityTags, qualificationDate, orgForTags] = await Promise.all([
    repo.latestForOrg(organizationId),
    repo.orgTags(organizationId),
    repo.firstQualifiedAt(organizationId),
    repo.orgForTagExplanation(organizationId),
  ]);

  if (!orgForTags) throw new ApiError(404, `Organization not found: ${organizationId}`);

  const matchedRules = (qualification?.matchedRules as { rule: string; reason: string; passed: boolean }[] | null) ?? null;
  const qualificationReasons = matchedRules?.filter((r) => r.passed).map((r) => r.reason) ?? [];

  // Re-derive *why* each currently-assigned tag fired, on demand — same
  // deterministic rules that produced the stored tags, not a separate
  // stored reason column (tags.service.ts is the single source of truth).
  const metrics = new Map<string, number>();
  for (const fm of orgForTags.financialMetrics) metrics.set(fm.metricDefinition.metricKey, Number(fm.value));
  for (const tm of orgForTags.technologyMetrics) metrics.set(tm.metricDefinition.metricKey, Number(tm.value));
  const allExplanations = explainOpportunityTags(orgForTags, metrics);
  const opportunityTagReasons = allExplanations.filter((e) => opportunityTags.includes(e.tag));

  return {
    isQualified: qualification?.isQualified ?? null,
    matchedRules,
    qualificationReasons,
    ruleGroup: qualification?.ruleGroup?.groupName ?? null,
    icpScore: score ? Number(score.icpScore) : null,
    opportunityTier: tier?.opportunityTier ? String(tier.opportunityTier).replace(/_/g, ' ') : null,
    opportunityTags,
    opportunityTagReasons,
    qualificationDate,
    lastUpdatedDate: qualification?.evaluatedAt ?? null,
  };
}
