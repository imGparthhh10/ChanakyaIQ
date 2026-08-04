import { prisma } from '../../db';

// Prisma's `db pull` doesn't introspect views by default (needs the `views`
// preview feature, not enabled here), so the schema's v_pipeline_funnel /
// v_organization_dashboard views are queried via $queryRaw rather than a
// generated model delegate.
export class DashboardRepository {
  async pipelineFunnel() {
    return prisma.$queryRaw<{ status: string; org_count: bigint }[]>`SELECT * FROM v_pipeline_funnel`;
  }

  async totalOrganizations() {
    return prisma.organization.count();
  }

  async totalsByCategory() {
    const rows = await prisma.organization.groupBy({ by: ['subsectorId'], _count: { organizationId: true } });
    const subsectors = await prisma.subsector.findMany();
    const byId = new Map(subsectors.map((s) => [s.subsectorId, s.subsectorName]));
    return rows.map((r) => ({
      category: r.subsectorId != null ? byId.get(r.subsectorId) ?? 'Unknown' : 'Uncategorized',
      count: r._count.organizationId,
    }));
  }

  async totalRevenue() {
    const def = await prisma.metricDefinition.findUnique({ where: { metricKey: 'revenue' } });
    if (!def) return 0;
    const agg = await prisma.financialMetric.aggregate({ where: { metricId: def.metricId }, _sum: { value: true } });
    return Number(agg._sum.value ?? 0);
  }
}
