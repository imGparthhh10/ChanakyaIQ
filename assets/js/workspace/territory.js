/**
 * territory.js — Account ownership store.
 *
 * Maps { companyKey → userId }. Backed by localStorage; every read
 * and write emits a bus event so the sidebar's "My Book (N)" counter
 * and the My Territory table stay in sync.
 *
 * Assignment rules ("all NBFC in West → Priya") are deliberately NOT
 * implemented as auto-rules yet — they'd need a UI to author. For now:
 *   - Manual assign from Company 360 header
 *   - Bulk assign from Lists page ("Assign selected to Me")
 *   - "Assign to Me" one-click on any company
 */

import { bus }              from '../utils/eventBus.js';
import { safeParseJSON }    from '../utils/sanitize.js';
import { identity }         from './identity.js';

const KEY = 'boip.territory.v1';

function read()  { return safeParseJSON(localStorage.getItem(KEY), {}) || {}; }
function write(v) {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* noop */ }
}

// ─── Public API ───────────────────────────────────

export const territory = {
  /** Owner userId for a company (or null). */
  ownerOf(companyKey) {
    if (!companyKey) return null;
    return read()[companyKey] || null;
  },

  /** Assign a company to a user. Pass null to unassign. */
  assign(companyKey, userId) {
    if (!companyKey) return;
    const all = read();
    if (userId) all[companyKey] = userId;
    else        delete all[companyKey];
    write(all);
    bus.emit('territory:change', { companyKey, userId: userId || null });
  },

  /** Convenience: assign to the current user. */
  assignToMe(companyKey) {
    const u = identity.current();
    if (u) this.assign(companyKey, u.id);
  },

  /** Return all companyKeys owned by the given user. */
  keysOf(userId) {
    if (!userId) return [];
    const all = read();
    return Object.entries(all).filter(([, uid]) => uid === userId).map(([k]) => k);
  },

  /** All company records owned by the current user, resolved via cache. */
  myBook(cache) {
    const u = identity.current();
    if (!u || !cache) return [];
    const keys = new Set(this.keysOf(u.id));
    return cache.getAll().filter(r => keys.has(r._dedupeKey));
  },

  /** Coverage per user: userId → account count. */
  coverage() {
    const all = read();
    const out = {};
    for (const uid of Object.values(all)) out[uid] = (out[uid] || 0) + 1;
    return out;
  },

  /** Total assigned accounts. */
  totalAssigned() {
    return Object.keys(read()).length;
  },

  /** Bulk-assign a set of companyKeys to a user. */
  bulkAssign(companyKeys, userId) {
    if (!Array.isArray(companyKeys) || !userId) return;
    const all = read();
    for (const k of companyKeys) all[k] = userId;
    write(all);
    bus.emit('territory:change', { bulk: true, userId, count: companyKeys.length });
  },
};
