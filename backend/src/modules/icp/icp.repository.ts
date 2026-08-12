import { prisma } from '../../db';

export class IcpRepository {
  /** sectorId is nullable on both tables -- NULL means "applies to every
   *  sector" (kept for forward compatibility); a set sectorId scopes a
   *  rule group to only that sector's organizations. Without this, a
   *  sector-specific rule group (e.g. Government's Allocated Budget rule)
   *  would also run against every other sector's organizations. */
  getActiveRuleGroups() {
    return prisma.ruleGroup.findMany({
      where: { isActive: true },
      include: { qualificationRules: { where: { isActive: true }, include: { metricDefinition: true } } },
    });
  }

  getActiveScoreModels() {
    return prisma.scoreModel.findMany({
      where: { isActive: true },
      include: { scoreWeights: { include: { metricDefinition: true } } },
    });
  }

  async allOrganizationsWithMetrics() {
    return prisma.organization.findMany({
      include: {
        financialMetrics: { include: { metricDefinition: true } },
        technologyMetrics: { include: { metricDefinition: true } },
        technologyProfiles: true,
        leadershipProfile: true,
        sector: true,
        subsector: true,
        contacts: true,
      },
    });
  }

  recordQualification(organizationId: string, ruleGroupId: number, isQualified: boolean, matchedRules: unknown) {
    return prisma.qualificationResult.create({
      data: { organizationId, ruleGroupId, isQualified, matchedRules: matchedRules as any },
    });
  }

  async recordScore(organizationId: string, scoreModelId: number, icpScore: number, opportunityTier: string) {
    await prisma.$transaction([
      prisma.scoreHistory.create({ data: { organizationId, scoreModelId, icpScore } }),
      prisma.tierHistory.create({ data: { organizationId, opportunityTier: opportunityTier as any } }),
      prisma.organization.update({
        where: { organizationId },
        data: { icpScore, opportunityTier: opportunityTier as any },
      }),
    ]);
  }

  async orgTags(organizationId: string): Promise<string[]> {
    const rows = await prisma.organizationTag.findMany({
      where: { organizationId },
      include: { opportunityTag: true },
    });
    return rows.map((r) => r.opportunityTag.tagName);
  }

  latestForOrg(organizationId: string) {
    return Promise.all([
      prisma.qualificationResult.findFirst({ where: { organizationId }, orderBy: { evaluatedAt: 'desc' }, include: { ruleGroup: true } }),
      prisma.scoreHistory.findFirst({ where: { organizationId }, orderBy: { recordedAt: 'desc' } }),
      prisma.tierHistory.findFirst({ where: { organizationId }, orderBy: { recordedAt: 'desc' } }),
    ]);
  }

  /** First time this org ever qualified — "Qualification Date" in the ICP
   *  spec. `latestForOrg`'s qualificationResult.evaluatedAt (regardless of
   *  outcome) is "Last Updated Date" — no schema change needed for either. */
  async firstQualifiedAt(organizationId: string): Promise<Date | null> {
    const first = await prisma.qualificationResult.findFirst({
      where: { organizationId, isQualified: true },
      orderBy: { evaluatedAt: 'asc' },
      select: { evaluatedAt: true },
    });
    return first?.evaluatedAt ?? null;
  }

  private tagIdCache: Map<string, number> | null = null;

  private async tagIdByName(): Promise<Map<string, number>> {
    if (this.tagIdCache) return this.tagIdCache;
    const tags = await prisma.opportunityTag.findMany();
    this.tagIdCache = new Map(tags.map((t) => [t.tagName, t.tagId]));
    return this.tagIdCache;
  }

  /** Delete-then-insert — idempotent across re-runs of the scoring job. */
  async replaceOrgTags(organizationId: string, tagNames: string[]) {
    const idByName = await this.tagIdByName();
    const tagIds = tagNames.map((name) => idByName.get(name)).filter((id): id is number => id != null);

    await prisma.$transaction([
      prisma.organizationTag.deleteMany({ where: { organizationId } }),
      ...tagIds.map((tagId) => prisma.organizationTag.create({ data: { organizationId, tagId } })),
    ]);
  }

  /** Thresholds are DB-driven, not hardcoded anywhere in application code —
   *  this is what makes them editable from the dashboard (Stage 1). */
  listQualificationRules() {
    return prisma.qualificationRule.findMany({
      include: { metricDefinition: true, ruleGroup: true },
      orderBy: { ruleId: 'asc' },
    });
  }

  updateRuleThreshold(ruleId: string, thresholdValue: number) {
    return prisma.qualificationRule.update({
      where: { ruleId },
      data: { thresholdValue },
      include: { metricDefinition: true },
    });
  }

  /** qualification_results is append-only (one row per org per rule group
   *  per /icp/run) and unbounded -- latestForOrg() only ever reads the
   *  newest row, so older ones are pure dead weight. Keeps the `keepPerOrg`
   *  most recent rows per (organization, rule group) pair and deletes the
   *  rest. Scoped by rule group, not just org, so this stays correct if an
   *  org is ever evaluated against more than one rule group at once (not
   *  the case today -- sectors are mutually exclusive -- but cheap to get
   *  right now). Does NOT touch score_history/tier_history -- those are the
   *  actual long-term trend record and are intentionally never pruned. */
  async pruneQualificationHistory(keepPerOrg: number): Promise<number> {
    const result = await prisma.$executeRaw`
      DELETE FROM qualification_results
      WHERE qualification_id IN (
        SELECT qualification_id FROM (
          SELECT qualification_id,
                 ROW_NUMBER() OVER (
                   PARTITION BY organization_id, rule_group_id
                   ORDER BY evaluated_at DESC
                 ) AS rn
          FROM qualification_results
        ) ranked
        WHERE rn > ${keepPerOrg}
      )
    `;
    return Number(result);
  }

  /** Everything explainOpportunityTags() (tags.service.ts) needs to
   *  re-derive *why* a tag fired, for one org on demand. */
  orgForTagExplanation(organizationId: string) {
    return prisma.organization.findUnique({
      where: { organizationId },
      include: {
        financialMetrics: { include: { metricDefinition: true } },
        technologyMetrics: { include: { metricDefinition: true } },
        technologyProfiles: true,
        sector: true,
        subsector: true,
      },
    });
  }
}
