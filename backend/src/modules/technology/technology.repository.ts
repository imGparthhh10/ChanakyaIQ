import { prisma } from '../../db';
import { resolveMetricDefinition } from '../../utils/metricDefinitions';

export class TechnologyRepository {
  async listMetricsForOrg(organizationId: string) {
    return prisma.technologyMetric.findMany({
      where: { organizationId },
      include: { metricDefinition: true },
      orderBy: [{ metricId: 'asc' }, { fiscalYear: 'desc' }],
    });
  }

  async listProfilesForOrg(organizationId: string) {
    return prisma.technologyProfile.findMany({ where: { organizationId } });
  }

  async getMetric(organizationId: string, metricKey: string, fiscalYear?: number | null) {
    const def = await prisma.metricDefinition.findUnique({ where: { metricKey } });
    if (!def) return null;
    return prisma.technologyMetric.findFirst({
      where: { organizationId, metricId: def.metricId, fiscalYear: fiscalYear ?? null },
      orderBy: { fiscalYear: 'desc' },
    });
  }

  /** See FinancialsRepository.upsertMetric for the NULL-fiscal-year rationale — same pattern here. */
  async upsertMetric(
    organizationId: string,
    metricKey: string,
    fiscalYear: number | null,
    value: number,
    sourceDocumentId: string | null = null,
    confidence: number | null = null,
    displayName = metricKey,
    sourceCitation: string | null = null,
    sourceUrl: string | null = null,
  ) {
    const def = await resolveMetricDefinition(metricKey, displayName, 'Technology');
    const existing = await prisma.technologyMetric.findFirst({
      where: { organizationId, metricId: def.metricId, fiscalYear },
    });
    if (existing) {
      return prisma.technologyMetric.update({
        where: { technologyMetricId: existing.technologyMetricId },
        data: { value, sourceDocumentId, confidence, sourceCitation, sourceUrl },
      });
    }
    return prisma.technologyMetric.create({
      data: { organizationId, metricId: def.metricId, fiscalYear, value, sourceDocumentId, confidence, sourceCitation, sourceUrl },
    });
  }

  /** Categorical facts (Low/Medium/High maturity levels, ERP/CRM vendor, etc.) — separate from numeric metrics. */
  async upsertProfile(organizationId: string, category: string, valueText: string) {
    const existing = await prisma.technologyProfile.findFirst({ where: { organizationId, category } });
    if (existing) {
      return prisma.technologyProfile.update({ where: { techProfileId: existing.techProfileId }, data: { valueText } });
    }
    return prisma.technologyProfile.create({ data: { organizationId, category, valueText } });
  }
}
