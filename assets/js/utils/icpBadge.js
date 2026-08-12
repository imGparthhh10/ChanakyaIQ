/**
 * icpBadge.js — shared ICP Tier → color/badge mapping.
 *
 * Single source of truth so company360.js, myTerritory.js, and
 * whitespace.js don't each hand-roll the same tier→color map. Tiers match
 * backend/src/modules/icp/icp.service.ts exactly (Strategic/Tier 1/Tier 2/
 * Tier 3/Watchlist) — values come straight from our own API, not user
 * input, so no HTML-escaping is needed here.
 */

const TIER_COLORS = {
  Strategic: '#10B981',
  'Tier 1':   '#14B8A6',
  'Tier 2':   '#F59E0B',
  'Tier 3':   '#F97316',
  Watchlist:  '#64748B',
};

export function tierColor(tier) {
  return TIER_COLORS[tier] || '#64748B';
}

/** Small pill badge, e.g. for a table column. Empty string if unscored. */
export function tierBadgeHtml(tier, score) {
  if (!tier) return '<span class="mt-muted">—</span>';
  const color = tierColor(tier);
  const scoreSuffix = score != null ? ` (${Math.round(score)})` : '';
  return `<span class="mt-score-chip" style="color:${color};border-color:${color}44">${tier}${scoreSuffix}</span>`;
}

/**
 * Business Intent Engine (backend/src/modules/businessIntent/) — same
 * tier-to-color convention as above, values match
 * businessIntent.scoring.ts's classification set exactly.
 */
const BUSINESS_INTENT_COLORS = {
  Qualified:      '#10B981',
  Watch:          '#F59E0B',
  'Not Qualified': '#64748B',
  'Not Scored':    '#475569',
};

export function businessIntentColor(classification) {
  return BUSINESS_INTENT_COLORS[classification] || '#64748B';
}

export function businessIntentBadgeHtml(classification, score) {
  if (!classification || classification === 'Not Scored') return '<span class="mt-muted">—</span>';
  const color = businessIntentColor(classification);
  const scoreSuffix = score != null ? ` (${score})` : '';
  return `<span class="mt-score-chip" style="color:${color};border-color:${color}44">${classification}${scoreSuffix}</span>`;
}

// final_priority values match businessIntent.priority.ts exactly.
const FINAL_PRIORITY_COLORS = {
  'Hot -- top priority':                                       '#EF4444',
  'High potential, needs nurturing':                           '#F59E0B',
  'Strategic fit, no signal yet -- outbound trigger candidate': '#8B5CF6',
  'Signal-driven -- worth pursuing despite lower ICP fit':      '#14B8A6',
  'Moderate -- monitor':                                        '#64748B',
  Deprioritize:                                                 '#475569',
};

export function finalPriorityColor(priority) {
  return FINAL_PRIORITY_COLORS[priority] || '#64748B';
}

export function finalPriorityBadgeHtml(priority) {
  if (!priority) return '<span class="mt-muted">—</span>';
  const color = finalPriorityColor(priority);
  // Full label kept in the title attribute (badge text itself would
  // overflow a table cell for the two longest labels) — hover for the
  // whole phrase, chip shows the short lead-in.
  const short = priority.split(' -- ')[0].split(',')[0];
  return `<span class="mt-score-chip" style="color:${color};border-color:${color}44" title="${priority}">${short}</span>`;
}
