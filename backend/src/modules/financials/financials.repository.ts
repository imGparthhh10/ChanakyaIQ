import { prisma } from '../../db';
import { resolveMetricDefinition } from '../../utils/metricDefinitions';

export class FinancialsRepository {
  async listForOrg(organizationId: string) {
    return prisma.financialMetric.findMany({
      where: { organizationId },
      include: { metricDefinition: true },
      orderBy: [{ metricId: 'asc' }, { fiscalYear: 'desc' }],
    });
  }

  async getMetric(organizationId: string, metricKey: string, fiscalYear?: number | null) {
    const def = await prisma.metricDefinition.findUnique({ where: { metricKey } });
    if (!def) return null;
    return prisma.financialMetric.findFirst({
      where: { organizationId, metricId: def.metricId, fiscalYear: fiscalYear ?? null },
      orderBy: { fiscalYear: 'desc' },
    });
  }

  /**
   * Resolves metricKey through metric_definitions (auto-creating it if
   * unseen), never a hardcoded column.
   *
   * NOTE: does a manual find-then-write instead of Prisma's compound-key
   * `upsert()`. The schema's `UNIQUE(organization_id, metric_id, fiscal_year)`
   * constraint does not actually deduplicate rows where fiscal_year IS NULL
   * (standard SQL: NULLs are never equal to each other in a unique
   * constraint), which is exactly the case for every untagged metric per
   * our fiscal-year decision — a real `upsert()` would silently re-insert a
   * new row on every re-run instead of updating. This trades perfect
   * concurrency-safety for correctness under the schema as given; a
   * COALESCE-based partial unique index would close the race but requires
   * raw SQL Prisma can't express in `@@unique`, so it's flagged here rather
   * than silently patched into eip_schema.sql.
   */
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
    const def = await resolveMetricDefinition(metricKey, displayName, 'Financial');
    const existing = await prisma.financialMetric.findFirst({
      where: { organizationId, metricId: def.metricId, fiscalYear },
    });
    if (existing) {
      return prisma.financialMetric.update({
        where: { financialMetricId: existing.financialMetricId },
        data: { value, sourceDocumentId, confidence, sourceCitation, sourceUrl },
      });
    }
    return prisma.financialMetric.create({
      data: { organizationId, metricId: def.metricId, fiscalYear, value, sourceDocumentId, confidence, sourceCitation, sourceUrl },
    });
  }
}
