/**
 * commandPalette.js — Global ⌘K / Ctrl+K command palette.
 *
 * Provides:
 *   - Fuzzy company search (name / category / state / city / CEO)
 *   - Navigation shortcuts (Home, Companies, Lists, Signals, Map, Analytics)
 *   - Recently viewed companies
 *   - Bookmarked companies
 *   - Keyboard-first: arrows to navigate, Enter to select, Esc to close
 *
 * Zero-cost when closed. All content is generated per-open from the
 * live DataCache — no snapshots, no stale results.
 */

import { bus }                   from './utils/eventBus.js';
import { h, qs, qsa }           from './utils/dom.js';
import { escapeHTML }            from './utils/sanitize.js';
import { trapFocus, announce }   from './utils/a11y.js';
import { debounce, CleanupRegistry } from './utils/perf.js';
import { workspace }             from './workspace/store.js';
import { dataEngine }            from './data/data.js';
import { navigate }              from './router.js';
import { parseNL, applyPostFilters } from './ai/nlSearch.js';

const NAV_ACTIONS = [
  { id: 'nav:home',      label: 'Go to Home',       hint: 'Dashboard overview',    icon: '⌂', do: () => navigate('/') },
  { id: 'nav:lists',     label: 'Go to Lists',      hint: 'Saved company lists',   icon: '☰', do: () => navigate('/lists') },
  { id: 'nav:signals',   label: 'Go to Signals',    hint: 'Time-ordered feed',     icon: '⚡', do: () => navigate('/signals') },
  { id: 'nav:map',       label: 'Focus Map',        hint: 'Scroll to Geo Atlas',   icon: '◈', do: () => scrollToId('map-container') },
  { id: 'nav:analytics', label: 'Focus Analytics',  hint: 'Scroll to charts',      icon: '▤', do: () => scrollToId('charts-section') },
  { id: 'act:compare',   label: 'Open Compare',     hint: 'Up to 3 companies',     icon: '⇄', do: () => bus.emit('compare:open') },
  { id: 'act:export',    label: 'Open Export',      hint: 'CSV / XLSX / PDF / PNG', icon: '⬇', do: () => bus.emit('export:open') },
];

function scrollToId(id) {
  navigate('/');
  setTimeout(() => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
}

// ─── State ────────────────────────────────────────

let _overlay = null;
let _cleanup = null;
let _activeIdx = 0;
let _items = [];       // current visible items
let _releaseFocus = null;

// ─── Result computation ──────────────────────────

/**
 * Score a company record against a lowercase query.
 * Returns 0 if no match, higher = better.
 */
function scoreCompany(rec, q) {
  const name = (rec.companyName || '').toLowerCase();
  const cat  = (rec.category || '').toLowerCase();
  const city = (rec.hqCity || '').toLowerCase();
  const st   = (rec.state || '').toLowerCase();
  const ceo  = (rec.ceo || '').toLowerCase();

  let s = 0;
  if (name === q)                  s += 100;
  else if (name.startsWith(q))     s += 60;
  else if (name.includes(q))       s += 30;

  if (cat.includes(q))             s += 8;
  if (city.includes(q))            s += 6;
  if (st.includes(q))              s += 5;
  if (ceo.includes(q))             s += 4;

  return s;
}

function buildItems(query) {
  const q = String(query || '').trim().toLowerCase();
  const cache = dataEngine.cache;
  const items = [];

  // No query → show shortcuts + recent
  if (!q) {
    items.push({ group: 'Shortcuts', items: NAV_ACTIONS.map(a => ({ ...a, kind: 'action' })) });

    if (cache) {
      const recent = workspace.getRecent().slice(0, 5);
      if (recent.length) {
        items.push({
          group: 'Recently Viewed',
          items: recent.map(r => ({
            id: 'recent:' + r.key,
            kind: 'company',
            key: r.key,
            label: r.name,
            hint: r.category || 'Company',
            icon: '↻',
          })),
        });
      }
      const bms = workspace.getBookmarks().slice(0, 5);
      if (bms.length) {
        items.push({
          group: 'Bookmarks',
          items: bms.map(b => ({
            id: 'bm:' + b.key,
            kind: 'company',
            key: b.key,
            label: b.name,
            hint: b.category || 'Company',
            icon: '★',
          })),
        });
      }
    }
    return items;
  }

  // Natural-language interpretation — surface as top hit when we recognize enough
  const nl = parseNL(query);
  if (nl.understood && Object.keys(nl.filters).length >= 1) {
    let matches = cache ? cache.query(nl.filters) : [];
    matches = applyPostFilters(matches, nl.filters);
    items.push({
      group: 'Natural Language',
      items: [{
        id:   'nl:' + query,
        kind: 'action',
        icon: '✨',
        label: `Search: ${nl.tokens.join(' · ')}`,
        hint:  `${matches.length.toLocaleString('en-IN')} matches · press Enter to open Home with these filters`,
        do:    () => {
          navigate('/');
          // Give router a tick to switch to home, then push filters
          setTimeout(() => {
            const applied = { ...nl.filters };
            delete applied.scoreMin; // scoreMin is client-side; drop from filter chip payload
            bus.emit('filter:reset');
            bus.emit('filter:apply', applied);
          }, 50);
        },
      }],
    });
  }

  // Query present — rank companies
  if (cache) {
    const scored = [];
    for (const r of cache.getAll()) {
      const s = scoreCompany(r, q);
      if (s > 0) scored.push({ rec: r, score: s });
      if (scored.length > 500) break; // safety cap
    }
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, 8).map(({ rec }) => ({
      id: 'co:' + rec._dedupeKey,
      kind: 'company',
      key: rec._dedupeKey,
      label: rec.companyName,
      hint: [rec.category, rec.hqCity, rec.state].filter(Boolean).join(' · '),
      icon: (rec.companyName || 'CO').slice(0, 2).toUpperCase(),
      iconType: 'initials',
    }));
    if (top.length) items.push({ group: 'Companies', items: top });
  }

  // Branch matches — surface when query looks like IFSC or matches branch fields
  const branches = dataEngine.branches || [];
  if (branches.length && q.length >= 3) {
    const isIfsc = /^[A-Z]{4}\d?/i.test(q);
    const branchHits = [];
    const seenBranch = new Set();
    for (const b of branches) {
      if (branchHits.length >= 6) break;
      const key = b.id;
      if (seenBranch.has(key)) continue;
      const bl = (b.branchName || '').toLowerCase();
      const ifsc = (b.ifsc || '').toLowerCase();
      const city = (b.city || '').toLowerCase();
      const dist = (b.district || '').toLowerCase();
      const hit = (isIfsc && ifsc.includes(q)) ||
                  bl.includes(q) || city.includes(q) || dist.includes(q);
      if (hit) {
        seenBranch.add(key);
        branchHits.push({
          id: 'br:' + b.id,
          kind: 'action',
          icon: '◉',
          label: b.branchName,
          hint: `${b.parentName} · ${[b.city, b.state].filter(Boolean).join(', ')}${b.ifsc ? ' · ' + b.ifsc : ''}`,
          do: () => { location.hash = '#/company/' + encodeURIComponent(b.parentKey); },
        });
      }
    }
    if (branchHits.length) items.push({ group: 'Branches', items: branchHits });
  }

  // Match navigation actions too
  const navMatches = NAV_ACTIONS.filter(a =>
    a.label.toLowerCase().includes(q) || a.hint.toLowerCase().includes(q)
  );
  if (navMatches.length) {
    items.push({ group: 'Actions', items: navMatches.map(a => ({ ...a, kind: 'action' })) });
  }

  return items;
}

// ─── Rendering ────────────────────────────────────

function flattenItems(groups) {
  const flat = [];
  for (const g of groups) for (const i of g.items) flat.push(i);
  return flat;
}

function renderGroups(groups) {
  if (!groups.length) {
    return '<div class="cp-empty">No results. Try a company name, sector, or city.</div>';
  }
  return groups.map(g => `
    <div class="cp-group" role="group" aria-label="${escapeHTML(g.group)}">
      <div class="cp-group-title">${escapeHTML(g.group)}</div>
      ${g.items.map((it, i) => `
        <div class="cp-item" role="option" data-id="${escapeHTML(it.id)}" tabindex="-1">
          <span class="cp-item-icon${it.iconType === 'initials' ? ' cp-initials' : ''}">${escapeHTML(it.icon || '·')}</span>
          <span class="cp-item-body">
            <span class="cp-item-label">${escapeHTML(it.label)}</span>
            <span class="cp-item-hint">${escapeHTML(it.hint || '')}</span>
          </span>
          <span class="cp-item-kbd">↵</span>
        </div>
      `).join('')}
    </div>
  `).join('');
}

function updateActive(newIdx) {
  const nodes = qsa('.cp-item', _overlay);
  if (!nodes.length) return;
  _activeIdx = ((newIdx % nodes.length) + nodes.length) % nodes.length;
  nodes.forEach((n, i) => n.classList.toggle('active', i === _activeIdx));
  nodes[_activeIdx]?.scrollIntoView({ block: 'nearest' });
}

function refresh(query) {
  const groups = buildItems(query);
  _items = flattenItems(groups);
  const list = qs('#cp-list', _overlay);
  if (list) list.innerHTML = renderGroups(groups);
  _activeIdx = 0;
  updateActive(0);
  wireItemHandlers();
}

function wireItemHandlers() {
  qsa('.cp-item', _overlay).forEach((el, i) => {
    el.addEventListener('mouseenter', () => updateActive(i));
    el.addEventListener('click', () => executeItem(_items[i]));
  });
}

function executeItem(item) {
  if (!item) return;
  close();
  if (item.kind === 'company') {
    navigate(`/company/${encodeURIComponent(item.key)}`);
  } else if (item.kind === 'action' && typeof item.do === 'function') {
    item.do();
  }
}

// ─── Open / Close ─────────────────────────────────

function open() {
  if (_overlay) return;

  _overlay = h('div', {
    class: 'cp-overlay',
    id: 'cp-overlay',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': 'Command palette',
  });

  _overlay.innerHTML = `
    <div class="cp-modal glass-panel" role="combobox" aria-expanded="true" aria-controls="cp-list">
      <div class="cp-head">
        <span class="cp-search-icon">⌕</span>
        <input class="cp-input" id="cp-input" type="text" placeholder="Search companies, jump to any page, run an action…" autocomplete="off" aria-label="Command input" spellcheck="false" />
        <kbd class="cp-kbd">Esc</kbd>
      </div>
      <div class="cp-list" id="cp-list" role="listbox"></div>
      <div class="cp-foot">
        <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
        <span><kbd>↵</kbd> select</span>
        <span><kbd>Esc</kbd> close</span>
      </div>
    </div>`;

  document.body.appendChild(_overlay);

  const input = qs('#cp-input', _overlay);
  refresh('');

  const onInput = debounce(() => refresh(input.value), 80);

  _cleanup = new CleanupRegistry();
  _cleanup.addListener(input, 'input', onInput);
  _cleanup.addListener(input, 'keydown', (e) => {
    if (e.key === 'ArrowDown')      { e.preventDefault(); updateActive(_activeIdx + 1); }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); updateActive(_activeIdx - 1); }
    else if (e.key === 'Enter')     { e.preventDefault(); executeItem(_items[_activeIdx]); }
    else if (e.key === 'Escape')    { e.preventDefault(); close(); }
  });
  _cleanup.addListener(_overlay, 'click', (e) => {
    if (e.target === _overlay) close();
  });

  requestAnimationFrame(() => {
    _overlay.classList.add('open');
    input.focus();
  });

  _releaseFocus = trapFocus(_overlay, { restore: document.activeElement });
  announce('Command palette opened.', 'polite');
}

function close() {
  if (!_overlay) return;
  _overlay.classList.remove('open');
  if (_releaseFocus) { _releaseFocus(); _releaseFocus = null; }
  if (_cleanup) { _cleanup.dispose(); _cleanup = null; }
  const el = _overlay;
  _overlay = null;
  setTimeout(() => el.remove(), 180);
}

// ─── Public Init ──────────────────────────────────

export function initCommandPalette() {
  document.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    // Cmd/Ctrl + K
    if ((e.metaKey || e.ctrlKey) && key === 'k') {
      e.preventDefault();
      _overlay ? close() : open();
      return;
    }
    // '/' shortcut when not typing in a field
    if (key === '/' && !_overlay) {
      const t = document.activeElement;
      const isField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (!isField) {
        e.preventDefault();
        open();
      }
    }
  });

  bus.on('palette:open', open);
}
