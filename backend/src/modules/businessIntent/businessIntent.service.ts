import { BusinessIntentRepository } from './businessIntent.repository';
import { computeFinalPriority } from './businessIntent.priority';
import { computeBusinessIntent } from './businessIntent.scoring';
import type { BusinessIntentClassification } from './businessIntent.types';

const repo = new BusinessIntentRepository();

// The spec's "lowest/no-fit tier" for the cleanup rule, confirmed against
// icp.service.ts's tierForScore(): 'Watchlist' is the explicit catch-all
// below Tier_3 (score < 40). An organization the ICP engine has never
// scored at all (opportunityTier still null) has equally "no ICP fit" on
// record, so it's included in the same bucket rather than treated as a
// protected default.
function isNoFitIcpTier(opportunityTier: string | null): boolean {
  return opportunityTier === 'Watchlist' || opportunityTier === null;
}

const REMOVAL_REASON = 'Failed both Business Intent and ICP qualification';

export interface ArchivalCandidate {
  organizationId: string;
  organizationName: string;
  businessIntentScore: number;
  businessIntentClassification: BusinessIntentClassification;
  icpScore: number | null;
  icpTier: string | null;
  reason: string;
}

export interface BusinessIntentRunSummary {
  dryRun: boolean;
  organizationsScored: number;
  qualified: number;
  watch: number;
  notQualified: number;
  excluded: number;
  archived: number; // number actually archived -- 0 when dryRun is true
  archivalCandidates: ArchivalCandidate[]; // what was (dry run) or what got (real run) archived
}

export async function runBusinessIntentEngine(dryRun: boolean): Promise<BusinessIntentRunSummary> {
  const [orgs, icpTiers] = await Promise.all([repo.loadOrgsForScoring(), repo.loadIcpTiers()]);

  const summary: BusinessIntentRunSummary = {
    dryRun,
    organizationsScored: 0,
    qualified: 0,
    watch: 0,
    notQualified: 0,
    excluded: 0,
    archived: 0,
    archivalCandidates: [],
  };

  for (const org of orgs) {
    const result = computeBusinessIntent(org);
    const icp = icpTiers.get(org.organizationId) ?? { icpScore: null, opportunityTier: null };

    summary.organizationsScored++;
    if (result.excluded) summary.excluded++;
    if (result.classification === 'Qualified') summary.qualified++;
    else if (result.classification === 'Watch') summary.watch++;
    else summary.notQualified++;

    const shouldArchive = result.classification === 'Not Qualified' && isNoFitIcpTier(icp.opportunityTier);

    if (shouldArchive) {
      const candidate: ArchivalCandidate = {
        organizationId: org.organizationId,
        organizationName: org.legalName,
        businessIntentScore: result.score,
        businessIntentClassification: result.classification,
        icpScore: icp.icpScore,
        icpTier: icp.opportunityTier,
        reason: REMOVAL_REASON,
      };
      summary.archivalCandidates.push(candidate);

      if (!dryRun) {
        await repo.archiveOrganization(candidate);
        summary.archived++;
      }
      // Per spec's Step 4 pseudocode: archived orgs skip the normal
      // score/classification UPDATE + score_history insert entirely —
      // they're getting a removal_log row instead, not both.
      continue;
    }

    if (!dryRun) {
      const finalPriority = computeFinalPriority(result.classification, icp.opportunityTier);
      await repo.saveScoringResult(org.organizationId, result, finalPriority);
    }
  }

  return summary;
}

export async function getRemovals(page: number, pageSize: number) {
  return repo.listRemovals(page, pageSize);
}
