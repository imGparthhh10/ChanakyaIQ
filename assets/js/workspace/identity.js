/**
 * identity.js — Lightweight identity + role model.
 *
 * No backend. The current user is stored in localStorage; a small
 * roster of team members is baked in so role switching is instant.
 * Every downstream surface (My Territory, Executive dashboard,
 * Owner filter, ownership panels) reads from this module.
 *
 * The roster is a seed only — it can be edited via the sidebar
 * "Switch user" control, and additions persist to localStorage.
 */

import { bus }              from '../utils/eventBus.js';
import { safeParseJSON }    from '../utils/sanitize.js';

const KEY_CURRENT = 'boip.identity.current.v1';
const KEY_ROSTER  = 'boip.identity.roster.v1';

/** Baked-in seed roster — covers every workflow role. */
const SEED_ROSTER = [
  { id: 'user_exec',       name: 'Aditi Sharma',   role: 'Executive',        initials: 'AS', color: '#8B5CF6' },
  { id: 'user_sales_west', name: 'Priya Nair',     role: 'Sales · West',     initials: 'PN', color: '#6366F1' },
  { id: 'user_sales_south',name: 'Ravi Kumar',     role: 'Sales · South',    initials: 'RK', color: '#22D3EE' },
  { id: 'user_bdr',        name: 'Neha Patil',     role: 'BDR',              initials: 'NP', color: '#10B981' },
  { id: 'user_se',         name: 'Karthik Menon',  role: 'Solutions Arch.',  initials: 'KM', color: '#F59E0B' },
  { id: 'user_mkt',        name: 'Ishaan Verma',   role: 'Marketing',        initials: 'IV', color: '#F43F5E' },
];

const ROLES = ['Executive', 'Sales · West', 'Sales · South', 'BDR', 'Solutions Arch.', 'Marketing'];

// ─── Storage ──────────────────────────────────────

function readRoster() {
  const stored = safeParseJSON(localStorage.getItem(KEY_ROSTER), null);
  if (Array.isArray(stored) && stored.length > 0) return stored;
  // Seed on first use
  writeRoster(SEED_ROSTER);
  return SEED_ROSTER.slice();
}

function writeRoster(roster) {
  try { localStorage.setItem(KEY_ROSTER, JSON.stringify(roster)); } catch { /* noop */ }
}

function readCurrentId() {
  const id = localStorage.getItem(KEY_CURRENT);
  const roster = readRoster();
  if (id && roster.find(u => u.id === id)) return id;
  // Default: first Sales user (most common workflow role)
  const defaultUser = roster.find(u => /Sales/.test(u.role)) || roster[0];
  writeCurrentId(defaultUser.id);
  return defaultUser.id;
}

function writeCurrentId(id) {
  try { localStorage.setItem(KEY_CURRENT, id); } catch { /* noop */ }
}

// ─── Public API ───────────────────────────────────

export const identity = {
  ROLES,

  /** Roster of team members (personas / actual users). */
  roster() { return readRoster(); },

  /** Currently logged-in user (returns the full record). */
  current() {
    const id = readCurrentId();
    return readRoster().find(u => u.id === id) || null;
  },

  /** User by id. */
  user(id) {
    return readRoster().find(u => u.id === id) || null;
  },

  /** Change the active user. Emits `identity:change`. */
  setCurrent(id) {
    if (!readRoster().find(u => u.id === id)) return;
    writeCurrentId(id);
    bus.emit('identity:change', { user: this.current() });
  },

  /** Whether the current user's role matches (case-insensitive substring). */
  isRole(pattern) {
    const u = this.current();
    if (!u) return false;
    return new RegExp(pattern, 'i').test(u.role);
  },

  /** All roles (used by role-based routing decisions later). */
  roles() { return ROLES.slice(); },
};
