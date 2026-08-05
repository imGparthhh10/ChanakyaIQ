import { prisma } from '../../db';

export class IcpRepository {
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
}
