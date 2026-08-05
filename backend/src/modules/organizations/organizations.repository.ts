import { prisma } from '../../db';

const INCLUDE = {
  sector: true,
  subsector: true,
  addresses: { include: { city: true, state: true } },
  leadershipProfile: true,
  financialMetrics: { include: { metricDefinition: true } },
  technologyMetrics: { include: { metricDefinition: true } },
  technologyProfiles: true,
  organizationTags: { include: { opportunityTag: true } },
  qualificationResults: { take: 1, orderBy: { evaluatedAt: 'desc' } as const },
} as const;

export class OrganizationsRepository {
  async findAll() {
    const [orgs, branchCounts] = await Promise.all([
      prisma.organization.findMany({ include: INCLUDE, orderBy: { legalName: 'asc' } }),
      prisma.branch.groupBy({ by: ['organizationId'], _count: { branchId: true } }),
    ]);
    const branchCountByOrg = new Map(branchCounts.map((b) => [b.organizationId, b._count.branchId]));
    return orgs.map((o) => ({ ...o, _branchCount: branchCountByOrg.get(o.organizationId) ?? 0 }));
  }

  async findById(organizationId: string) {
    const [org, branchCount] = await Promise.all([
      prisma.organization.findUnique({ where: { organizationId }, include: INCLUDE }),
      prisma.branch.count({ where: { organizationId } }),
    ]);
    if (!org) return null;
    return { ...org, _branchCount: branchCount };
  }
}
