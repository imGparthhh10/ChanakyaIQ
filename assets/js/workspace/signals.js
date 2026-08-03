/**
 * signals.js — Shared signal derivation.
 *
 * Extracted so both the Signals feed page and the "buying signals"
 * filter chip use the same definition. When real signal-ingestion
 * (news, hiring, funding APIs) lands later, we replace ONE function
 * and the whole app benefits.
 */

/** Signal type ids used across the app. */
export const SIGNAL_TYPES = ['buying', 'gap', 'risk', 'initiative'];

/**
 * Derive signal types for one record. Returns a Set of type ids.
 * Cheap — pure computation, no I/O.
 */
export function deriveSignalTypes(rec) {
  const out = new Set();
  if (!rec) return out;

  if (rec.buyingPotential != null && rec.buyingPotential >= 20) out.add('buying');
  if (rec.cloudMaturity === 'Low')                              out.add('gap');
  if (rec.aiReadiness === 'Low' && (rec.revenue || 0) > 500)   out.add('gap');
  if (rec.cyberMaturity === 'Low')                              out.add('risk');
  if (rec.initiatives)                                          out.add('initiative');

  return out;
}

/** Whether the record has any signal of the given type (or any at all). */
export function hasSignal(rec, type) {
  const types = deriveSignalTypes(rec);
  if (!type || type === 'any') return types.size > 0;
  return types.has(type);
}
