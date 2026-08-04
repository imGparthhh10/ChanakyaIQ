import { prisma } from '../../db';
import { normalizeForDedup } from '../../utils/dedupeKey';

export interface DedupeIndex {
  byKey: Map<string, string>; // dedupeKey -> organizationId
}

/** Pre-loads existing organizations (if any, e.g. a re-run) into an in-memory index. */
export async function buildDedupeIndex(): Promise<DedupeIndex> {
  const existing = await prisma.organization.findMany({ select: { organizationId: true, legalName: true } });
  const byKey = new Map<string, string>();
  for (const o of existing) {
    const key = normalizeForDedup(o.legalName);
    if (key) byKey.set(key, o.organizationId);
  }
  return { byKey };
}

/**
 * Exact match by dedupeKey first (covers same-run duplicates across sheets/
 * files, and re-runs against an already-imported DB). Falls back to a
 * pg_trgm fuzzy match on legal_name, scoped to the same state, for names
 * that render to slightly different dedupeKeys across sources.
 */
export async function findExistingOrgId(
  index: DedupeIndex,
  companyName: string,
  stateName: string | null,
): Promise<string | null> {
  const key = normalizeForDedup(companyName);
  const exact = index.byKey.get(key);
  if (exact) return exact;

  if (!stateName) return null;
  const rows = await prisma.$queryRaw<{ organization_id: string; score: number }[]>`
    SELECT o.organization_id, similarity(o.legal_name, ${companyName}) AS score
    FROM organizations o
    JOIN addresses a ON a.organization_id = o.organization_id AND a.is_headquarters
    JOIN states st ON st.state_id = a.state_id
    WHERE st.state_name = ${stateName} AND o.legal_name % ${companyName}
    ORDER BY score DESC
    LIMIT 1
  `;
  return rows[0]?.organization_id ?? null;
}
