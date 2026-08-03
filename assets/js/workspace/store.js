/**
 * store.js — Workspace persistence layer.
 *
 * Backs enterprise workflow features (notes, bookmarks, engagement
 * status, saved lists, recently viewed) against localStorage.
 * All operations are synchronous, corruption-safe, and quota-aware.
 *
 * Every record is keyed by the company's `_dedupeKey` (URL-safe
 * canonical name) so entries survive data reloads and dataset swaps.
 */

import { bus }             from '../utils/eventBus.js';
import { safeParseJSON,
         sanitizeFilename } from '../utils/sanitize.js';
import { announce }        from '../utils/a11y.js';

const KEYS = {
  notes:     'boip.notes.v1',
  bookmarks: 'boip.bookmarks.v1',
  status:    'boip.status.v1',
  lists:     'boip.lists.v1',
  recent:    'boip.recent.v1',
};

const STATUS_VALUES = ['New', 'Researching', 'Contacted', 'Qualified', 'Won', 'Lost', 'DQ'];
const RECENT_CAP    = 20;
const NOTES_PER_CO  = 100;

// ─── Storage helpers ──────────────────────────────

function read(key, fallback) {
  try {
    return safeParseJSON(localStorage.getItem(key), fallback);
  } catch { return fallback; }
}

function write(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
    return true;
  } catch (err) {
    console.warn(`[workspace] localStorage write failed for ${key}:`, err);
    return false;
  }
}

function emit(topic, payload) {
  bus.emit(`workspace:${topic}`, payload);
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ─── Notes ────────────────────────────────────────

function _notes() { return read(KEYS.notes, {}) || {}; }

function getNotes(companyKey) {
  if (!companyKey) return [];
  const all = _notes();
  return Array.isArray(all[companyKey]) ? all[companyKey] : [];
}

function addNote(companyKey, text) {
  const clean = String(text || '').trim().slice(0, 2000);
  if (!companyKey || !clean) return null;

  const all = _notes();
  const list = Array.isArray(all[companyKey]) ? all[companyKey] : [];

  const note = {
    id: uid(),
    text: clean,
    createdAt: new Date().toISOString(),
    author: 'You',
  };
  list.unshift(note);
  all[companyKey] = list.slice(0, NOTES_PER_CO);
  write(KEYS.notes, all);
  emit('notes:change', { companyKey, notes: all[companyKey] });
  announce('Note added.', 'polite');
  return note;
}

function removeNote(companyKey, noteId) {
  const all = _notes();
  const list = all[companyKey] || [];
  const next = list.filter(n => n.id !== noteId);
  all[companyKey] = next;
  write(KEYS.notes, all);
  emit('notes:change', { companyKey, notes: next });
}

// ─── Bookmarks ────────────────────────────────────

function _bookmarks() { return read(KEYS.bookmarks, {}) || {}; }

function isBookmarked(companyKey) {
  return !!_bookmarks()[companyKey];
}

function toggleBookmark(companyKey, meta = {}) {
  if (!companyKey) return false;
  const all = _bookmarks();
  const now = new Date().toISOString();
  if (all[companyKey]) {
    delete all[companyKey];
    write(KEYS.bookmarks, all);
    emit('bookmarks:change', { companyKey, active: false });
    announce('Bookmark removed.', 'polite');
    return false;
  }
  all[companyKey] = { at: now, name: meta.name || companyKey, category: meta.category || '' };
  write(KEYS.bookmarks, all);
  emit('bookmarks:change', { companyKey, active: true });
  announce('Bookmarked.', 'polite');
  return true;
}

function getBookmarks() {
  const all = _bookmarks();
  return Object.entries(all)
    .map(([key, meta]) => ({ key, ...meta }))
    .sort((a, b) => (b.at || '').localeCompare(a.at || ''));
}

// ─── Engagement Status ───────────────────────────

function _status() { return read(KEYS.status, {}) || {}; }

function getStatus(companyKey) {
  if (!companyKey) return 'New';
  const all = _status();
  return all[companyKey]?.value || 'New';
}

function setStatus(companyKey, value) {
  if (!companyKey || !STATUS_VALUES.includes(value)) return;
  const all = _status();
  all[companyKey] = { value, at: new Date().toISOString() };
  write(KEYS.status, all);
  emit('status:change', { companyKey, value });
  announce(`Status set to ${value}.`, 'polite');
}

function getStatusCounts() {
  const all = _status();
  const out = Object.fromEntries(STATUS_VALUES.map(s => [s, 0]));
  for (const rec of Object.values(all)) {
    if (rec?.value && out[rec.value] != null) out[rec.value]++;
  }
  return out;
}

// ─── Lists ────────────────────────────────────────

function _lists() { return read(KEYS.lists, {}) || {}; }

function getLists() {
  const all = _lists();
  return Object.entries(all)
    .map(([id, l]) => ({ id, name: l.name, count: (l.members || []).length, createdAt: l.createdAt, updatedAt: l.updatedAt }))
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

function getList(id) {
  const all = _lists();
  return all[id] || null;
}

function createList(rawName) {
  const name = sanitizeFilename(rawName, '').replace(/[_]/g, ' ').slice(0, 60).trim() || 'Untitled list';
  const id = uid();
  const all = _lists();
  const now = new Date().toISOString();
  all[id] = { name, members: [], createdAt: now, updatedAt: now };
  write(KEYS.lists, all);
  emit('lists:change', { action: 'create', id, name });
  announce(`List "${name}" created.`, 'polite');
  return id;
}

function renameList(id, rawName) {
  const name = String(rawName || '').trim().slice(0, 60);
  if (!name) return;
  const all = _lists();
  if (!all[id]) return;
  all[id].name = name;
  all[id].updatedAt = new Date().toISOString();
  write(KEYS.lists, all);
  emit('lists:change', { action: 'rename', id, name });
}

function deleteList(id) {
  const all = _lists();
  if (!all[id]) return;
  const name = all[id].name;
  delete all[id];
  write(KEYS.lists, all);
  emit('lists:change', { action: 'delete', id });
  announce(`List "${name}" deleted.`, 'polite');
}

function addToList(id, companyKey) {
  const all = _lists();
  if (!all[id] || !companyKey) return;
  const members = new Set(all[id].members || []);
  members.add(companyKey);
  all[id].members = [...members];
  all[id].updatedAt = new Date().toISOString();
  write(KEYS.lists, all);
  emit('lists:change', { action: 'add', id, companyKey });
}

function removeFromList(id, companyKey) {
  const all = _lists();
  if (!all[id]) return;
  all[id].members = (all[id].members || []).filter(k => k !== companyKey);
  all[id].updatedAt = new Date().toISOString();
  write(KEYS.lists, all);
  emit('lists:change', { action: 'remove', id, companyKey });
}

// ─── Recently Viewed ─────────────────────────────

function _recent() { return read(KEYS.recent, []) || []; }

function markRecent(companyKey, meta = {}) {
  if (!companyKey) return;
  const list = _recent().filter(r => r.key !== companyKey);
  list.unshift({
    key: companyKey,
    name: meta.name || companyKey,
    category: meta.category || '',
    at: new Date().toISOString(),
  });
  write(KEYS.recent, list.slice(0, RECENT_CAP));
  emit('recent:change');
}

function getRecent() {
  return _recent();
}

// ─── Public API ───────────────────────────────────

export const workspace = {
  STATUS_VALUES,

  getNotes, addNote, removeNote,
  isBookmarked, toggleBookmark, getBookmarks,
  getStatus, setStatus, getStatusCounts,
  getLists, getList, createList, renameList, deleteList, addToList, removeFromList,
  markRecent, getRecent,

  /** Wipe every workspace record. Use with care. */
  reset() {
    for (const k of Object.values(KEYS)) {
      try { localStorage.removeItem(k); } catch { /* noop */ }
    }
    emit('reset');
  },

  /** Summary counts for the shell badge / home. */
  summary() {
    return {
      bookmarks: Object.keys(_bookmarks()).length,
      notes:     Object.values(_notes()).reduce((s, arr) => s + (Array.isArray(arr) ? arr.length : 0), 0),
      lists:     Object.keys(_lists()).length,
      statusCounts: getStatusCounts(),
    };
  },
};
