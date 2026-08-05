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
