import { MetricCategory } from '@prisma/client';
import { prisma } from '../db';

/**
 * Find-or-create a metric_definitions row by key. Used by both the
 * financials/technology repositories and the Phase 3 import mapper so a
 * spreadsheet column that has no existing metric catalog entry gets a new
 * *row*, never a new table column (per the schema's dynamic-metric design).
 */
export async function resolveMetricDefinition(
  metricKey: string,
  displayName: string,
  category: MetricCategory,
  unit = 'INR_CR',
) {
  const existing = await prisma.metricDefinition.findUnique({ where: { metricKey } });
  if (existing) return existing;
  return prisma.metricDefinition.create({
    data: { metricKey, displayName, category, unit },
  });
}
