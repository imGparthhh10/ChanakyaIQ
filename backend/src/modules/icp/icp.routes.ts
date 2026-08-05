import { Router } from 'express';
import { runIcpScoring } from './icp.service';
import { IcpRepository } from './icp.repository';

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

export async function getOrgIcp(organizationId: string) {
  const [[qualification, score, tier], opportunityTags, qualificationDate] = await Promise.all([
    repo.latestForOrg(organizationId),
    repo.orgTags(organizationId),
    repo.firstQualifiedAt(organizationId),
  ]);

  const matchedRules = (qualification?.matchedRules as { rule: string; reason: string; passed: boolean }[] | null) ?? null;
  const qualificationReasons = matchedRules?.filter((r) => r.passed).map((r) => r.reason) ?? [];

  return {
    isQualified: qualification?.isQualified ?? null,
    matchedRules,
    qualificationReasons,
    ruleGroup: qualification?.ruleGroup?.groupName ?? null,
    icpScore: score ? Number(score.icpScore) : null,
    opportunityTier: tier?.opportunityTier ?? null,
    opportunityTags,
    qualificationDate,
    lastUpdatedDate: qualification?.evaluatedAt ?? null,
  };
}
