// Shared cell-cleaning helpers for the Industrial Clusters and Govt Finance
// loaders (both hand-authored spreadsheets with the same encoding quirks:
// stray non-breaking spaces, "N/A"/"-" placeholders, state-name variants
// that don't exactly match the `states` table's existing spelling).

export function cleanCell(v: any): string {
  if (v == null) return '';
  const s = String(v).replace(/ /g, ' ').trim();
  if (!s || /^n\/?\.?a$/i.test(s) || s === '-' || s === '—') return '';
  return s;
}

// Aligned to the exact strings already in the `states` table (checked live
// via psql) rather than the more common "Jammu & Kashmir" spelling etc.
const STATE_ALIASES: Record<string, string> = {
  'delhi ncr': 'Delhi',
  'ncr': 'Delhi',
  'chhatisgarh': 'Chhattisgarh',
  'jammu & kashmir': 'Jammu And Kashmir',
  'jammu and kashmir': 'Jammu And Kashmir',
  'andaman & nicobar islands': 'Andaman And Nicobar Islands',
  'andaman and nicobar islands': 'Andaman And Nicobar Islands',
  'dadra & nagar haveli': 'Dadra And Nagar Haveli',
  'daman & diu': 'Daman And Diu',
};

/** Some source cells list more than one state ("Haryana, Delhi NCR") for a
 *  location spanning a border -- only the first listed state is usable as
 *  a single FK, so it's used as the primary and the raw string is kept
 *  wherever the caller also stores free text, so nothing is silently lost. */
export function normalizeStateName(raw: string): string {
  const first = cleanCell(raw).split(',')[0].trim();
  if (!first) return '';
  const alias = STATE_ALIASES[first.toLowerCase()];
  return alias || first;
}
