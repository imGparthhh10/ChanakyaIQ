/**
 * branches.js — Branch Explorer page (route: #/branches)
 *
 * Enterprise-scale surface for browsing every branch in the dataset.
 * Designed for 50,000+ rows — uses the shared virtual-scroll list so
 * only ~30 rows render at any time regardless of total row count.
 *
 * Layout:
 *   ┌ Header — search + summary tiles                     ┐
 *   ├ Filter row — State / District / City / Bank / Cat.  ┤
 *   └ Virtual-scroll branch table (5K – 50K+ rows)         ┘
 *
 * Every row links back to its parent bank's Company 360.
 */

import { bus }                    from '../utils/eventBus.js';
import { qs, qsa, h }            from '../utils/dom.js';
import { escapeHTML, sanitizeSearch } from '../utils/sanitize.js';
import { announce }               from '../utils/a11y.js';
import { debounce, CleanupRegistry } from '../utils/perf.js';
import { mountVirtualList }       from '../utils/virtualScroll.js';
import { Icon }                   from '../components/icons.js';
import { dataEngine }             from '../data/data.js';

const ROW_HEIGHT = 48;   // px — must match .bx-row CSS
const RESULT_CAP = 20000; // hard cap for the virtual list (safety)

// ─── Helpers ──────────────────────────────────────

function svgIcon(name) {
  const el = Icon(name);
  const tmp = document.createElement('div');
  tmp.appendChild(el);
  return tmp.innerHTML;
}

function unique(items, key) {
  const set = new Set();
  for (const it of items) {
    const v = it[key];
    if (v) set.add(v);
  }
  return [...set].sort();
}

// ─── State (module-scoped for this page instance) ─

let _filters = { state: '', district: '', city: '', parent: '', category: '', q: '' };
let _all = [];
let _filtered = [];
let _list = null;   // virtual list handle
let _cleanup = null;

// ─── Filter application ───────────────────────────

function applyFilters() {
  const q = (_filters.q || '').toLowerCase();
  _filtered = _all.filter(b => {
    if (_filters.state    && b.state    !== _filters.state) return false;
    if (_filters.district && b.district !== _filters.district) return false;
    if (_filters.city     && b.city     !== _filters.city) return false;
    if (_filters.parent   && b.parentKey !== _filters.parent) return false;
    if (_filters.category && b.category !== _filters.category) return false;
    if (q) {
      const hay = (b.branchName + ' ' + b.parentName + ' ' + (b.ifsc || '') + ' ' +
                   (b.city || '') + ' ' + (b.district || '') + ' ' + (b.address || '')).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  return _filtered;
}

// ─── Row rendering ────────────────────────────────

function renderRow(branch) {
  const href = '#/company/' + encodeURIComponent(branch.parentKey);
  return `<a class="bx-row" href="${href}">
    <div class="bx-cell bx-cell-name" title="${escapeHTML(branch.address || branch.branchName)}">${escapeHTML(branch.branchName)}</div>
    <div class="bx-cell bx-cell-parent">${escapeHTML(branch.parentName)}</div>
    <div class="bx-cell bx-cell-loc">${escapeHTML([branch.city, branch.state].filter(Boolean).join(', ') || '—')}</div>
    <div class="bx-cell bx-cell-district">${escapeHTML(branch.district || '—')}</div>
    <div class="bx-cell bx-cell-ifsc">${escapeHTML(branch.ifsc || '—')}</div>
    <div class="bx-cell bx-cell-cat">${escapeHTML(branch.category || '—')}</div>
  </a>`;
}

// ─── Summary tiles ────────────────────────────────

function summarize(branches) {
  const states = new Set();
  const cities = new Set();
  const districts = new Set();
  const parents = new Set();
  for (const b of branches) {
    if (b.state) states.add(b.state);
    if (b.city) cities.add(b.city);
    if (b.district) districts.add(b.district);
    if (b.parentKey) parents.add(b.parentKey);
  }
  return {
    branches: branches.length,
    states: states.size,
    cities: cities.size,
    districts: districts.size,
    parents: parents.size,
  };
}

// ─── Mount ────────────────────────────────────────

function updateResults(container) {
  applyFilters();
  const capped = _filtered.slice(0, RESULT_CAP);
  if (_list) _list.update(capped);

  // Update summary tiles + result count
  const s = summarize(_filtered);
  const summary = qs('#bx-summary', container);
  if (summary) summary.innerHTML = summaryHTML(s, _all.length);

  const showing = qs('#bx-showing', container);
  if (showing) {
    showing.textContent = _filtered.length > RESULT_CAP
      ? `Showing first ${RESULT_CAP.toLocaleString('en-IN')} of ${_filtered.length.toLocaleString('en-IN')} matches — refine filters to narrow`
      : `${_filtered.length.toLocaleString('en-IN')} branch${_filtered.length === 1 ? '' : 'es'}`;
  }
}

function summaryHTML(s, total) {
  return `
    <div class="bx-tile"><span class="bx-tile-num">${s.branches.toLocaleString('en-IN')}</span><span class="bx-tile-lbl">Branches</span></div>
    <div class="bx-tile"><span class="bx-tile-num">${s.parents.toLocaleString('en-IN')}</span><span class="bx-tile-lbl">Parent banks</span></div>
    <div class="bx-tile"><span class="bx-tile-num">${s.states.toLocaleString('en-IN')}</span><span class="bx-tile-lbl">States</span></div>
    <div class="bx-tile"><span class="bx-tile-num">${s.districts.toLocaleString('en-IN')}</span><span class="bx-tile-lbl">Districts</span></div>
    <div class="bx-tile"><span class="bx-tile-num">${s.cities.toLocaleString('en-IN')}</span><span class="bx-tile-lbl">Cities</span></div>
  `;
}

function renderPage(container) {
  _all = dataEngine.branches || [];

  // Derive filter options once from the full dataset
  const stateOpts = unique(_all, 'state');
  const districtOpts = unique(_all, 'district');
  const cityOpts = unique(_all, 'city');
  const categoryOpts = unique(_all, 'category');
  const parents = [...new Map(_all.map(b => [b.parentKey, b.parentName])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]));

  container.innerHTML = `
    <div class="page-container bx-page">
      <header class="page-header glass-panel">
        <div class="page-header-left">
          <span class="eyebrow">Branch Intelligence</span>
          <h1 class="page-title">Branch Explorer</h1>
          <p class="page-sub">Browse every branch across every bank in the dataset. Enterprise-scale — powered by virtual scrolling.</p>
        </div>
        <div class="page-header-right">
          <input class="bx-search" id="bx-search" type="text" placeholder="Search branch name, IFSC, city, district, address…" autocomplete="off" />
        </div>
      </header>

      <section class="glass-panel bx-summary-strip" id="bx-summary">
        ${summaryHTML(summarize(_all), _all.length)}
      </section>

      <section class="glass-panel bx-filter-strip">
        <label class="bx-filter">
          <span>State</span>
          <select id="bx-f-state" class="bx-select">
            <option value="">All states</option>
            ${stateOpts.map(s => `<option value="${escapeHTML(s)}">${escapeHTML(s)}</option>`).join('')}
          </select>
        </label>
        <label class="bx-filter">
          <span>District</span>
          <select id="bx-f-district" class="bx-select">
            <option value="">All districts</option>
            ${districtOpts.map(s => `<option value="${escapeHTML(s)}">${escapeHTML(s)}</option>`).join('')}
          </select>
        </label>
        <label class="bx-filter">
          <span>City</span>
          <select id="bx-f-city" class="bx-select">
            <option value="">All cities</option>
            ${cityOpts.map(s => `<option value="${escapeHTML(s)}">${escapeHTML(s)}</option>`).join('')}
          </select>
        </label>
        <label class="bx-filter">
          <span>Parent bank</span>
          <select id="bx-f-parent" class="bx-select">
            <option value="">All banks</option>
            ${parents.map(([k, name]) => `<option value="${escapeHTML(k)}">${escapeHTML(name)}</option>`).join('')}
          </select>
        </label>
        <label class="bx-filter">
          <span>Category</span>
          <select id="bx-f-category" class="bx-select">
            <option value="">All categories</option>
            ${categoryOpts.map(s => `<option value="${escapeHTML(s)}">${escapeHTML(s)}</option>`).join('')}
          </select>
        </label>
        <button class="btn btn-ghost btn-sm bx-reset" id="bx-reset">${svgIcon('refresh')} Reset</button>
      </section>

      <section class="glass-panel bx-body">
        <div class="bx-header-row">
          <div class="bx-cell bx-cell-name">Branch</div>
          <div class="bx-cell bx-cell-parent">Parent bank</div>
          <div class="bx-cell bx-cell-loc">Location</div>
          <div class="bx-cell bx-cell-district">District</div>
          <div class="bx-cell bx-cell-ifsc">IFSC</div>
          <div class="bx-cell bx-cell-cat">Category</div>
        </div>
        <div class="bx-list-mount" id="bx-list"></div>
        <div class="bx-showing" id="bx-showing"></div>
      </section>
    </div>`;

  const listMount = qs('#bx-list', container);
  _list = mountVirtualList(listMount, {
    items: _all,
    rowHeight: ROW_HEIGHT,
    overscan: 8,
    emptyMessage: 'No branches match the current filters.',
    renderRow,
  });

  const cleanup = new CleanupRegistry();

  const searchInput = qs('#bx-search', container);
  const onSearch = debounce(() => {
    _filters.q = sanitizeSearch(searchInput.value);
    updateResults(container);
    announce(`${_filtered.length.toLocaleString('en-IN')} branches match.`, 'polite');
  }, 150);
  cleanup.addListener(searchInput, 'input', onSearch);

  const wireFilter = (id, key) => {
    const el = qs(id, container);
    if (!el) return;
    cleanup.addListener(el, 'change', () => {
      _filters[key] = el.value;
      updateResults(container);
    });
  };
  wireFilter('#bx-f-state',    'state');
  wireFilter('#bx-f-district', 'district');
  wireFilter('#bx-f-city',     'city');
  wireFilter('#bx-f-parent',   'parent');
  wireFilter('#bx-f-category', 'category');

  cleanup.addListener(qs('#bx-reset', container), 'click', () => {
    _filters = { state: '', district: '', city: '', parent: '', category: '', q: '' };
    ['#bx-f-state', '#bx-f-district', '#bx-f-city', '#bx-f-parent', '#bx-f-category'].forEach(sel => {
      const el = qs(sel, container); if (el) el.value = '';
    });
    if (searchInput) searchInput.value = '';
    updateResults(container);
  });

  // Initial paint
  updateResults(container);

  _cleanup = cleanup;
  return () => {
    if (_list) { _list.destroy(); _list = null; }
    cleanup.dispose();
  };
}

// ─── Router entry ─────────────────────────────────

export async function mountBranchExplorer(container) {
  if (!dataEngine.isReady) {
    container.innerHTML = `<div class="page-container"><section class="glass-panel"><p style="padding:var(--sp-6);text-align:center;color:var(--text-muted)">Waiting for data engine…</p></section></div>`;
    const off = bus.on('data:ready', () => { off(); mountBranchExplorer(container); });
    return () => off();
  }
  return renderPage(container);
}
