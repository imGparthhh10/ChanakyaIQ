// Shared types for the Business Intent Engine. Kept separate from
// businessIntent.scoring.ts so the pure scoring function's input contract
// is visible without pulling in Prisma/repository imports — makes the
// scoring module trivially unit-testable with plain object literals.

export type BusinessIntentClassification = 'Qualified' | 'Watch' | 'Not Qualified' | 'Not Scored';

// I (Identify Pain) and C-Competition are intentionally absent — verified
// against the actual schema that organizations.pain_point and
// organizations.cloud_provider don't exist anywhere (pain_point isn't even
// a column; cloud_provider has zero references in the codebase). Per
// explicit decision: score only the letters with real backing data (M, E,
// D-process) rather than fabricate or proxy the missing two.
export type MeddpiccLetter = 'M' | 'E' | 'D_process';

export interface BusinessIntentOrgInput {
  organizationId: string;
  legalName: string;
  sectorName: string | null;
  /** INR Crore, matching metric_definitions.unit's default across this schema. */
  metrics: {
    revenue: number | null;
    itSpend: number | null;
    cloudSpend: number | null;
  };
  /** technology_profiles rows: category is the free-text bucket
   *  (e.g. "Cloud Adoption Level"), valueText the Low/Medium/High level. */
  technologyProfiles: { category: string; valueText: string | null }[];
  /** Raw `leadership` table designations for is_current=true rows — not
   *  leadershipProfile, which has no CFO column at all. */
  leadershipDesignations: string[];
  /** True if this org has any `documents` row within the recency window.
   *  There is no RFP-specific document_type in the schema, so "recent
   *  document activity" is the honest substitute for "recent RFP activity"
   *  — see businessIntent.scoring.ts's D_process comment. */
  hasRecentDocumentActivity: boolean;
}

export interface BusinessIntentResult {
  score: number;
  classification: BusinessIntentClassification;
  lettersMatched: MeddpiccLetter[];
  excluded: boolean;
  exclusionReason: string | null;
}

// Step 3: cross-reference with the existing ICP opportunity_tier. Tier
// values verified against icp.service.ts / the opportunity_tier enum:
// 'Strategic' | 'Tier 1' | 'Tier 2' | 'Tier 3' | 'Watchlist'. 'Strategic'
// counts as the spec's "Tier1" bucket (the top tier); 'Tier 2'/'Tier 3'/
// 'Watchlist'/null all fall into the spec's "Tier2/3" bucket (everything
// below the top tier, including organizations with no tier yet).
export type FinalPriority =
  | 'Hot -- top priority'
  | 'High potential, needs nurturing'
  | 'Strategic fit, no signal yet -- outbound trigger candidate'
  | 'Signal-driven -- worth pursuing despite lower ICP fit'
  | 'Moderate -- monitor'
  | 'Deprioritize';
