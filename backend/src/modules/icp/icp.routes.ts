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
  const [qualification, score, tier] = await repo.latestForOrg(organizationId);
  return {
    isQualified: qualification?.isQualified ?? null,
    matchedRules: qualification?.matchedRules ?? null,
    ruleGroup: qualification?.ruleGroup?.groupName ?? null,
    icpScore: score ? Number(score.icpScore) : null,
    scoredAt: score?.recordedAt ?? null,
    opportunityTier: tier?.opportunityTier ?? null,
  };
}
