/**
 * scoreHistory.js — Per-company opportunity-score snapshot store.
 *
 * On every `data:ready` we snapshot the current score of every
 * company. The delta (current − previous) drives:
 *   - Executive dashboard "Score movers" tiles
 *   - The Δ-score filter in the Enterprise Filters panel
 *
 * When the underlying data is static, deltas stay at 0 — but the
 * plumbing is in place the moment real data updates roll in.
 */

import { bus }              from '../utils/eventBus.js';
import { safeParseJSON }    from '../utils/sanitize.js';
import { opportunityValue } from './scoring.js';

const KEY_CUR  = 'boip.scores.current.v1';
const KEY_PREV = 'boip.scores.previous.v1';

function read(key) { return safeParseJSON(localStorage.getItem(key), {}) || {}; }
function write(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* noop */ }
}

let _current = null; // in-memory cache

/** Rebuild current snapshot from the live DataCache. */
export function snapshotAll(cache) {
  if (!cache) return;
  const prev = read(KEY_CUR); // Whatever was "current" becomes "previous"
  const next = {};
  for (const rec of cache.getAll()) {
    if (!rec._dedupeKey) continue;
    next[rec._dedupeKey] = opportunityValue(rec);
  }
  write(KEY_PREV, prev);
  write(KEY_CUR,  next);
  _current = next;
  bus.emit('scoreHistory:snapshot', { count: Object.keys(next).length });
}

/** Score right now (uses in-memory cache when available). */
export function currentScore(key) {
  if (!key) return 0;
  if (!_current) _current = read(KEY_CUR);
  return _current[key] ?? 0;
}

/** Score at the previous snapshot. */
export function previousScore(key) {
  if (!key) return null;
  const prev = read(KEY_PREV);
  return key in prev ? prev[key] : null;
}

/** Δ = current − previous. null if we don't have a prior snapshot. */
export function delta(key) {
  const p = previousScore(key);
  if (p == null) return null;
  return currentScore(key) - p;
}

/** Top N movers up or down. Sort key is |Δ|. */
export function topMovers(direction = 'up', n = 10) {
  if (!_current) _current = read(KEY_CUR);
  const prev = read(KEY_PREV);
  const out = [];
  for (const [key, cur] of Object.entries(_current)) {
    if (!(key in prev)) continue;
    const d = cur - prev[key];
    if (direction === 'up'   && d > 0) out.push({ key, delta: d, current: cur });
    if (direction === 'down' && d < 0) out.push({ key, delta: d, current: cur });
  }
  out.sort((a, b) => direction === 'up' ? b.delta - a.delta : a.delta - b.delta);
  return out.slice(0, n);
}

/** Wire this once at boot — snapshots on every data:ready. */
export function installScoreHistory() {
  bus.on('data:ready', ({ cache }) => snapshotAll(cache));
}
