import type { BusinessIntentClassification, FinalPriority } from './businessIntent.types';

// Step 3: cross-reference with the existing ICP opportunity_tier enum
// ('Strategic' | 'Tier 1' | 'Tier 2' | 'Tier 3' | 'Watchlist' — verified
// against icp.service.ts / schema.prisma, not assumed). 'Strategic' is the
// spec's "Tier1" bucket; everything else (Tier 2/3/Watchlist/no tier yet)
// is the spec's "Tier2/3" bucket.
export function computeFinalPriority(
  classification: BusinessIntentClassification,
  opportunityTier: string | null,
): FinalPriority {
  const isTopTier = opportunityTier === 'Strategic';

  if (isTopTier) {
    if (classification === 'Qualified') return 'Hot -- top priority';
    if (classification === 'Watch') return 'High potential, needs nurturing';
    return 'Strategic fit, no signal yet -- outbound trigger candidate';
  }

  if (classification === 'Qualified') return 'Signal-driven -- worth pursuing despite lower ICP fit';
  if (classification === 'Watch') return 'Moderate -- monitor';
  return 'Deprioritize';
}
