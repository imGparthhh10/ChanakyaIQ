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
 * that render to slightly different dedupeKeys across sources -- but only
 * when `allowFuzzy` is true.
 *
 * `allowFuzzy` defaults to true for the original generic/Karnataka/Gujarat
 * bank-name callers this was built for (real near-duplicate spellings of
 * the same bank). It must be passed false for callers whose dedupe keys
 * are already exact and unique by construction (e.g. the Industrial
 * Clusters/Govt Finance loaders): confirmed live against this DB that
 * pg_trgm's default 0.3 similarity threshold false-positives badly on
 * many-candidates-per-state, similarly-worded names -- e.g.
 * "Power Department — Madhya Pradesh" scored 0.42 against the unrelated
 * "School Education Department (...) — Madhya Pradesh", well above 0.3.
 * Turning the fuzzy fallback on for a large same-state import silently
 * merged ~300 distinct departments/companies into each other.
 */
export async function findExistingOrgId(
  index: DedupeIndex,
  companyName: string,
  stateName: string | null,
  allowFuzzy = true,
): Promise<string | null> {
  const key = normalizeForDedup(companyName);
  const exact = index.byKey.get(key);
  if (exact) return exact;

  if (!stateName || !allowFuzzy) return null;
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
