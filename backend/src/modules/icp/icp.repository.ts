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
        leadershipProfile: true,
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

  latestForOrg(organizationId: string) {
    return Promise.all([
      prisma.qualificationResult.findFirst({ where: { organizationId }, orderBy: { evaluatedAt: 'desc' }, include: { ruleGroup: true } }),
      prisma.scoreHistory.findFirst({ where: { organizationId }, orderBy: { recordedAt: 'desc' } }),
      prisma.tierHistory.findFirst({ where: { organizationId }, orderBy: { recordedAt: 'desc' } }),
    ]);
  }
}
