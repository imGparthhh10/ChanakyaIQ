/**
 * filters.js — Enterprise filter bar with search, dropdowns,
 * cross-filtering, save/reset, and autocomplete.
 *
 * Renders into #filter-grid. Emits filter:apply / filter:reset
 * on the event bus so every other module reacts.
 */

import { bus }         from '../utils/eventBus.js';
import { qs, qsa, h } from '../utils/dom.js';
import { Icon }        from './icons.js';
import { PRODUCT_LIST } from '../recommendations/products.js';
import { sanitizeSearch, safeParseJSON, sanitizeFilename } from '../utils/sanitize.js';
import { announce } from '../utils/a11y.js';
import { identity } from '../workspace/identity.js';
import { dataEngine } from '../data/data.js';

// Cache district options so we don't re-scan branches on every render
let _districtCache = null;
function districtOptions() {
  if (_districtCache) return _districtCache;
  const set = new Set();
  for (const b of dataEngine.branches || []) {
    if (b.district) set.add(b.district);
  }
  _districtCache = [...set].sort();
  return _districtCache;
}

// ─── Constants ────────────────────────────────────

const REVENUE_BRACKETS = [
  { label: 'All',             min: null, max: null },
  { label: '< ₹100 Cr',      min: null, max: 100 },
  { label: '₹100 – 500 Cr',  min: 100,  max: 500 },
  { label: '₹500 – 1,000 Cr',min: 500,  max: 1000 },
  { label: '₹1,000 – 5,000 Cr', min: 1000, max: 5000 },
  { label: '₹5,000 – 10,000 Cr', min: 5000, max: 10000 },
  { label: '> ₹10,000 Cr',   min: 10000, max: null },
];

const EMPLOYEE_BRACKETS = [
  { label: 'All',         min: null, max: null },
  { label: '< 500',       min: null, max: 500 },
  { label: '500 – 2,000', min: 500,  max: 2000 },
  { label: '2,000 – 10,000', min: 2000, max: 10000 },
  { label: '10,000 – 50,000', min: 10000, max: 50000 },
  { label: '> 50,000',    min: 50000, max: null },
];

const ICP_SCORE_BRACKETS = [
  { label: 'All',        min: null, max: null },
  { label: '0 – 25',     min: 0,    max: 25 },
  { label: '25 – 50',    min: 25,   max: 50 },
  { label: '50 – 75',    min: 50,   max: 75 },
  { label: '75 – 90',    min: 75,   max: 90 },
  { label: '90 – 100',   min: 90,   max: 100 },
];

// Maps a `type: 'range'` filter def id to its cache.js query() filter keys.
const RANGE_FILTER_KEYS = {
  revenue:   ['revenueMin', 'revenueMax'],
  employees: ['employeeMin', 'employeeMax'],
  icpScore:  ['icpScoreMin', 'icpScoreMax'],
};

// Fixed set — the ICP engine's 5 tiers (backend/src/modules/icp/icp.service.ts).
const TIER_OPTIONS = [
  { value: 'Strategic', label: 'Strategic' },
  { value: 'Tier 1',     label: 'Tier 1' },
  { value: 'Tier 2',     label: 'Tier 2' },
  { value: 'Tier 3',     label: 'Tier 3' },
  { value: 'Watchlist',  label: 'Watchlist' },
];

// Live tag list — computed from whatever's actually in the loaded data,
// not a hardcoded list (opportunity_tags is DB-seeded and could grow).
function opportunityTagOptions(cache) {
  const set = new Set();
  for (const r of cache.getAll()) {
    for (const t of r.opportunityTags || []) set.add(t);
  }
  return [...set].sort();
}

const SAVED_FILTERS_KEY = 'esds_bfsi_saved_filters';
const MAX_SUGGESTIONS   = 8;
const DEBOUNCE_MS       = 180;

// ─── State ────────────────────────────────────────

let _cache       = null;
let _filters     = {};
let _activeCount = 0;

// ─── Filter Definitions ──────────────────────────

function ownerOptions() {
  // Special sentinels + roster names
  const roster = identity.roster();
  return [
    { value: 'me',         label: '● My accounts' },
    { value: 'unassigned', label: '○ Unassigned' },
    ...roster.map(u => ({ value: u.id, label: u.name })),
  ];
}

function buildFilterDefs(cache) {
  const painKeywords = extractPainKeywords(cache);

  return [
    // Workflow filters (new)
    { id: 'owner',        label: 'Owner',         type: 'select', icon: 'user',        optionObjs: ownerOptions() },
    { id: 'signal',       label: 'Signal Type',   type: 'select', icon: 'zap',         optionObjs: [
        { value: 'any',        label: 'Any signal' },
        { value: 'buying',     label: 'Buying signal' },
        { value: 'gap',        label: 'Modernization gap' },
        { value: 'risk',       label: 'Risk / cyber gap' },
        { value: 'initiative', label: 'Active initiative' },
    ] },
    { id: 'deltaMin',     label: 'Δ Score',       type: 'select', icon: 'trendUp',     optionObjs: [
        { value: '5',  label: 'Δ ≥ 5 points' },
        { value: '10', label: 'Δ ≥ 10 points' },
        { value: '20', label: 'Δ ≥ 20 points' },
    ] },

    // Firmographic
    { id: 'region',       label: 'Region',        type: 'select', icon: 'globe',       options: () => cache.regions() },
    { id: 'state',        label: 'State',         type: 'select', icon: 'map',         options: () => cache.states() },
    { id: 'district',     label: 'District',      type: 'select', icon: 'map',         options: () => districtOptions() },
    { id: 'city',         label: 'City',          type: 'select', icon: 'building',    options: () => cache.cities() },
    { id: 'category',     label: 'Category',      type: 'select', icon: 'layers',      options: () => cache.categories() },
    { id: 'subSector',    label: 'Sub Category',  type: 'select', icon: 'layers',      options: () => cache.subSectors() },
    { id: 'revenue',      label: 'Revenue',       type: 'range',  icon: 'dollar',      brackets: REVENUE_BRACKETS },
    { id: 'employees',    label: 'Employees',     type: 'range',  icon: 'user',        brackets: EMPLOYEE_BRACKETS },

    // ICP (backend/src/modules/icp/) — undefined/null on every record when
    // USE_LEGACY_EXCEL_PIPELINE is on, since Excel-sourced records never
    // carry these fields; the filters simply match nothing in that case.
    { id: 'opportunityTiers', label: 'Opportunity Tier', type: 'chips', icon: 'star',   optionObjs: TIER_OPTIONS },
    { id: 'icpScore',         label: 'ICP Score',        type: 'range', icon: 'trendUp', brackets: ICP_SCORE_BRACKETS },
    { id: 'opportunityTags',  label: 'Opportunity Tags', type: 'chips', icon: 'layers',  options: () => opportunityTagOptions(cache) },

    // Leadership
    { id: 'ceo',          label: 'CEO',           type: 'text',   icon: 'user',        placeholder: 'Search CEO…' },
    { id: 'cto',          label: 'CTO',           type: 'text',   icon: 'user',        placeholder: 'Search CTO…' },
    { id: 'cio',          label: 'CIO',           type: 'text',   icon: 'user',        placeholder: 'Search CIO…' },

    // Maturity + fit
    { id: 'cloudMaturity',label: 'Cloud Provider',type: 'select', icon: 'cloud',       options: () => cache.cloudMaturities() },
    { id: 'painPoint',    label: 'Pain Point',    type: 'select', icon: 'alertCircle', options: () => painKeywords },
    { id: 'aiReadiness',  label: 'AI Readiness',  type: 'select', icon: 'zap',         options: () => cache.aiReadinesses() },
    { id: 'cyberMaturity',label: 'Cyber Score',   type: 'select', icon: 'shield',      options: () => cache.cyberMaturities() },
    { id: 'esdsProduct',  label: 'ESDS Product',  type: 'select', icon: 'star',        options: () => PRODUCT_LIST.map(p => p.name) },
  ];
}

function extractPainKeywords(cache) {
  const freq = new Map();
  for (const r of cache.getAll()) {
    if (!r.painPoints) continue;
    const words = r.painPoints
      .toLowerCase()
      .split(/[,;|•·\n]+/)
      .map(w => w.trim().replace(/^[-–]\s*/, ''))
      .filter(w => w.length > 2 && w.length < 60);
    for (const w of words) {
      const key = w.charAt(0).toUpperCase() + w.slice(1);
      freq.set(key, (freq.get(key) || 0) + 1);
    }
  }
  return [...freq.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 80)
    .map(([k]) => k);
}

// ─── Render ───────────────────────────────────────

function renderFilterBar(cache) {
  const grid     = qs('#filter-grid');
  const section  = qs('#filter-section');
  if (!grid || !section) return;

  const defs = buildFilterDefs(cache);
  grid.innerHTML = '';
  grid.className = 'ef-grid';

  // Search bar (spans full row)
  grid.appendChild(renderSearchField());

  // Filter fields
  for (const def of defs) {
    grid.appendChild(renderFilterField(def));
  }

  // Action buttons row
  grid.appendChild(renderActionBar());

  // Wire section header
  const head = qs('.filter-head', section);
  if (head) {
    head.innerHTML = '';
    const left = h('div', { class: 'ef-head-left' }, [
      h('h2', { class: 'section-title', html: '<span class="dot dot-indigo"></span> Enterprise Filters' }),
      h('span', { class: 'ef-badge', id: 'ef-active-count' }, '0 active'),
    ]);
    const right = h('div', { class: 'ef-head-right' });
    const toggleBtn = h('button', {
      class: 'btn btn-ghost btn-sm ef-toggle-btn',
      html: `${iconHtml('chevronUp')} <span>Collapse</span>`,
      onclick: () => toggleCollapse(section, toggleBtn),
    });
    right.appendChild(toggleBtn);
    head.appendChild(left);
    head.appendChild(right);
  }

  // Wire reset from header
  const resetBtn = qs('[data-action="reset-filters"]', section);
  if (resetBtn) resetBtn.addEventListener('click', resetAllFilters);
}

// ─── Search Field ─────────────────────────────────

function renderSearchField() {
  const wrap = h('div', { class: 'ef-search-wrap' });

  const inputWrap = h('div', { class: 'ef-search-input-wrap' });
  const iconEl = Icon('search', 'ef-search-icon');
  const input  = h('input', {
    type: 'text',
    class: 'ef-search-input',
    id: 'ef-search',
    placeholder: 'Search companies, categories, cities, leaders…',
    autocomplete: 'off',
  });
  const clearBtn = h('button', {
    class: 'ef-search-clear hidden',
    'aria-label': 'Clear search',
    html: '✕',
    onclick: () => { input.value = ''; clearBtn.classList.add('hidden'); onSearchInput(''); },
  });

  inputWrap.appendChild(iconEl);
  inputWrap.appendChild(input);
  inputWrap.appendChild(clearBtn);

  const suggestBox = h('div', { class: 'ef-suggestions', id: 'ef-suggestions' });

  let debounceTimer = null;
  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const val = input.value.trim();
    clearBtn.classList.toggle('hidden', !val);
    debounceTimer = setTimeout(() => {
      onSearchInput(val);
      showSuggestions(val, suggestBox, input);
    }, DEBOUNCE_MS);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { suggestBox.classList.remove('open'); input.blur(); }
    if (e.key === 'Enter')  { suggestBox.classList.remove('open'); }
    handleSuggestionNav(e, suggestBox, input);
  });

  input.addEventListener('focus', () => {
    if (input.value.trim()) showSuggestions(input.value.trim(), suggestBox, input);
  });

  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) suggestBox.classList.remove('open');
  });

  wrap.appendChild(inputWrap);
  wrap.appendChild(suggestBox);
  return wrap;
}

function onSearchInput(val) {
  const clean = sanitizeSearch(val);
  if (clean) {
    _filters.search = clean;
  } else {
    delete _filters.search;
  }
  applyFilters();
}

// ─── Suggestions / Autocomplete ───────────────────

function showSuggestions(query, box, input) {
  if (!query || query.length < 2 || !_cache) {
    box.classList.remove('open');
    return;
  }

  const q = query.toLowerCase();
  const matches = [];
  const seen = new Set();

  for (const r of _cache.getAll()) {
    if (matches.length >= MAX_SUGGESTIONS) break;

    const fields = [
      { val: r.companyName, type: 'Company' },
      { val: r.category,    type: 'Category' },
      { val: r.hqCity,      type: 'City' },
      { val: r.state,       type: 'State' },
      { val: r.ceo,         type: 'CEO' },
      { val: r.cto,         type: 'CTO' },
    ];

    for (const f of fields) {
      if (!f.val || matches.length >= MAX_SUGGESTIONS) continue;
      const lv = f.val.toLowerCase();
      if (lv.includes(q) && !seen.has(f.val + f.type)) {
        seen.add(f.val + f.type);
        matches.push({ text: f.val, type: f.type, idx: lv.indexOf(q), len: q.length });
      }
    }
  }

  if (matches.length === 0) {
    box.classList.remove('open');
    return;
  }

  box.innerHTML = matches.map((m, i) => {
    const before = m.text.slice(0, m.idx);
    const match  = m.text.slice(m.idx, m.idx + m.len);
    const after  = m.text.slice(m.idx + m.len);
    return `<div class="ef-suggestion" data-idx="${i}" data-text="${esc(m.text)}">
      <span class="ef-sug-text">${esc(before)}<mark>${esc(match)}</mark>${esc(after)}</span>
      <span class="ef-sug-type">${m.type}</span>
    </div>`;
  }).join('');

  box.classList.add('open');

  box.querySelectorAll('.ef-suggestion').forEach(el => {
    el.addEventListener('click', () => {
      input.value = el.dataset.text;
      box.classList.remove('open');
      onSearchInput(el.dataset.text);
    });
  });
}

function handleSuggestionNav(e, box, input) {
  if (!box.classList.contains('open')) return;
  const items = qsa('.ef-suggestion', box);
  if (!items.length) return;

  let active = items.findIndex(el => el.classList.contains('active'));

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (active >= 0) items[active].classList.remove('active');
    active = (active + 1) % items.length;
    items[active].classList.add('active');
    items[active].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (active >= 0) items[active].classList.remove('active');
    active = active <= 0 ? items.length - 1 : active - 1;
    items[active].classList.add('active');
    items[active].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter' && active >= 0) {
    e.preventDefault();
    input.value = items[active].dataset.text;
    box.classList.remove('open');
    onSearchInput(items[active].dataset.text);
  }
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ─── Filter Fields ────────────────────────────────

function renderFilterField(def) {
  const wrap = h('div', { class: 'ef-field', 'data-filter-id': def.id });

  const label = h('label', { class: 'ef-label', for: `ef-${def.id}` }, [
    Icon(def.icon, 'ef-label-icon'),
    document.createTextNode(` ${def.label}`),
  ]);
  wrap.appendChild(label);

  if (def.type === 'select') {
    wrap.appendChild(renderSelectField(def));
  } else if (def.type === 'range') {
    wrap.appendChild(renderRangeField(def));
  } else if (def.type === 'text') {
    wrap.appendChild(renderTextField(def));
  } else if (def.type === 'chips') {
    wrap.appendChild(renderChipToggleField(def));
  }

  return wrap;
}

function renderSelectField(def) {
  const selectWrap = h('div', { class: 'ef-select-wrap' });
  const select = h('select', { class: 'ef-select', id: `ef-${def.id}` });

  const allOpt = h('option', { value: '' }, `All ${def.label}`);
  select.appendChild(allOpt);

  // Two option shapes supported:
  //   optionObjs: [{ value, label }]  — labels differ from values
  //   options(): string[]              — value === label
  if (Array.isArray(def.optionObjs)) {
    for (const o of def.optionObjs) {
      select.appendChild(h('option', { value: o.value }, o.label));
    }
  } else if (typeof def.options === 'function') {
    for (const o of def.options()) {
      select.appendChild(h('option', { value: o }, o));
    }
  }

  select.addEventListener('change', () => {
    if (select.value) {
      _filters[def.id] = select.value;
    } else {
      delete _filters[def.id];
    }
    applyFilters();
    updateCrossFilters(def.id);
  });

  const chevron = h('span', { class: 'ef-select-chevron', html: iconHtml('chevronDown') });
  selectWrap.appendChild(select);
  selectWrap.appendChild(chevron);
  return selectWrap;
}

function renderRangeField(def) {
  const selectWrap = h('div', { class: 'ef-select-wrap' });
  const select = h('select', { class: 'ef-select', id: `ef-${def.id}` });

  for (const b of def.brackets) {
    select.appendChild(h('option', { value: b.label }, b.label));
  }

  select.addEventListener('change', () => {
    const [minKey, maxKey] = RANGE_FILTER_KEYS[def.id];
    const bracket = def.brackets.find(b => b.label === select.value);
    if (!bracket || (bracket.min == null && bracket.max == null)) {
      delete _filters[minKey];
      delete _filters[maxKey];
    } else {
      if (bracket.min != null) _filters[minKey] = bracket.min; else delete _filters[minKey];
      if (bracket.max != null) _filters[maxKey] = bracket.max; else delete _filters[maxKey];
    }
    applyFilters();
  });

  const chevron = h('span', { class: 'ef-select-chevron', html: iconHtml('chevronDown') });
  selectWrap.appendChild(select);
  selectWrap.appendChild(chevron);
  return selectWrap;
}

// Multi-select chip toggle group — reuses the existing .c360-tag pill class
// (dashboard.css) rather than inventing a new component; selected/
// unselected state is a small inline-style toggle (opacity + accent
// border) rather than a new CSS class, since no existing class already
// expresses a "chip is active" state.
function renderChipToggleField(def) {
  const wrap = h('div', { class: 'ef-chip-group' });
  const options = Array.isArray(def.optionObjs)
    ? def.optionObjs
    : (typeof def.options === 'function' ? def.options() : []).map(v => ({ value: v, label: v }));

  const selected = new Set(_filters[def.id] || []);

  const styleFor = (isOn) => isOn
    ? 'opacity:1;border-color:var(--indigo);font-weight:600;cursor:pointer;'
    : 'opacity:0.55;cursor:pointer;';

  for (const o of options) {
    const chip = h('span', { class: 'c360-tag', style: styleFor(selected.has(o.value)) }, o.label);
    chip.addEventListener('click', () => {
      if (selected.has(o.value)) selected.delete(o.value); else selected.add(o.value);
      chip.setAttribute('style', styleFor(selected.has(o.value)));
      if (selected.size) _filters[def.id] = [...selected]; else delete _filters[def.id];
      applyFilters();
    });
    wrap.appendChild(chip);
  }

  return wrap;
}

function renderTextField(def) {
  const input = h('input', {
    type: 'text',
    class: 'ef-text-input',
    id: `ef-${def.id}`,
    placeholder: def.placeholder || `Search ${def.label}…`,
    autocomplete: 'off',
  });

  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (input.value.trim()) {
        _filters[def.id] = input.value.trim();
      } else {
        delete _filters[def.id];
      }
      applyFilters();
    }, DEBOUNCE_MS);
  });

  return input;
}

// ─── Action Bar ───────────────────────────────────

function renderActionBar() {
  const bar = h('div', { class: 'ef-action-bar' });

  const saveBtn = h('button', {
    class: 'btn btn-ghost btn-sm ef-action-btn',
    html: `${iconHtml('download')} Save Filter`,
    onclick: saveCurrentFilter,
  });

  const loadBtn = h('button', {
    class: 'btn btn-ghost btn-sm ef-action-btn',
    html: `${iconHtml('upload')} Load Filter`,
    onclick: showSavedFilters,
  });

  const resetBtn = h('button', {
    class: 'btn btn-ghost btn-sm ef-action-btn ef-reset-btn',
    html: `${iconHtml('refresh')} Reset All`,
    onclick: resetAllFilters,
  });

  bar.appendChild(saveBtn);
  bar.appendChild(loadBtn);
  bar.appendChild(resetBtn);

  // Active filter tags container
  const tagsWrap = h('div', { class: 'ef-active-tags', id: 'ef-active-tags' });
  bar.appendChild(tagsWrap);

  return bar;
}

// ─── Apply / Reset ────────────────────────────────

function applyFilters() {
  const activeKeys = Object.keys(_filters).filter(k => _filters[k] != null && _filters[k] !== '');
  _activeCount = activeKeys.length;

  const badge = qs('#ef-active-count');
  if (badge) {
    badge.textContent = `${_activeCount} active`;
    badge.classList.toggle('ef-badge-active', _activeCount > 0);
  }

  renderActiveTags();

  if (_activeCount === 0) {
    bus.emit('filter:reset');
    announce('Filters cleared. Showing all companies.', 'polite');
  } else {
    bus.emit('filter:apply', { ..._filters });
    const matches = _cache ? _cache.query(_filters).length : 0;
    announce(`${_activeCount} filter${_activeCount === 1 ? '' : 's'} applied. ${matches} companies match.`, 'polite');
  }
}

function resetAllFilters() {
  _filters = {};

  // Reset all select elements
  qsa('.ef-select').forEach(sel => { sel.selectedIndex = 0; });
  qsa('.ef-text-input').forEach(inp => { inp.value = ''; });
  qsa('.ef-chip-group .c360-tag').forEach(chip => chip.setAttribute('style', 'opacity:0.55;cursor:pointer;'));

  const searchInput = qs('#ef-search');
  if (searchInput) searchInput.value = '';

  const clearBtn = qs('.ef-search-clear');
  if (clearBtn) clearBtn.classList.add('hidden');

  applyFilters();
}

// ─── Active Filter Tags ──────────────────────────

function renderActiveTags() {
  const wrap = qs('#ef-active-tags');
  if (!wrap) return;
  wrap.innerHTML = '';

  for (const [key, val] of Object.entries(_filters)) {
    if (val == null || val === '' || (Array.isArray(val) && val.length === 0)) continue;
    const displayKey = key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
    const displayVal = Array.isArray(val) ? val.join(', ') : val;
    const tag = h('span', { class: 'ef-tag' }, [
      document.createTextNode(`${displayKey}: ${displayVal}`),
      h('button', {
        class: 'ef-tag-remove',
        'aria-label': `Remove ${displayKey} filter`,
        html: '✕',
        onclick: () => removeFilter(key),
      }),
    ]);
    wrap.appendChild(tag);
  }
}

function removeFilter(key) {
  delete _filters[key];

  // Reset corresponding UI element
  const el = qs(`#ef-${key}`);
  if (el) {
    if (el.tagName === 'SELECT') el.selectedIndex = 0;
    else el.value = '';
  }

  // Handle range filters
  if (key === 'revenueMin' || key === 'revenueMax') {
    delete _filters.revenueMin;
    delete _filters.revenueMax;
    const sel = qs('#ef-revenue');
    if (sel) sel.selectedIndex = 0;
  }
  if (key === 'employeeMin' || key === 'employeeMax') {
    delete _filters.employeeMin;
    delete _filters.employeeMax;
    const sel = qs('#ef-employees');
    if (sel) sel.selectedIndex = 0;
  }
  if (key === 'icpScoreMin' || key === 'icpScoreMax') {
    delete _filters.icpScoreMin;
    delete _filters.icpScoreMax;
    const sel = qs('#ef-icpScore');
    if (sel) sel.selectedIndex = 0;
  }
  if (key === 'opportunityTiers' || key === 'opportunityTags') {
    const wrap = qs(`[data-filter-id="${key}"] .ef-chip-group`);
    if (wrap) qsa('.c360-tag', wrap).forEach(chip => chip.setAttribute('style', 'opacity:0.55;cursor:pointer;'));
  }

  if (key === 'search') {
    const searchInput = qs('#ef-search');
    if (searchInput) searchInput.value = '';
    const clearBtn = qs('.ef-search-clear');
    if (clearBtn) clearBtn.classList.add('hidden');
  }

  applyFilters();
}

// ─── Cross-Filtering ─────────────────────────────

function updateCrossFilters(changedId) {
  if (!_cache) return;

  const currentResults = _cache.query(_filters);

  // Cascade: region → state → city
  if (changedId === 'region' || changedId === 'category') {
    updateSelectOptions('state', [...new Set(currentResults.map(r => r.state).filter(Boolean))].sort());
    updateSelectOptions('city', [...new Set(currentResults.map(r => r.hqCity).filter(Boolean))].sort());
  }
  if (changedId === 'state') {
    updateSelectOptions('city', [...new Set(currentResults.map(r => r.hqCity).filter(Boolean))].sort());
  }
  if (changedId === 'category') {
    updateSelectOptions('subSector', [...new Set(currentResults.map(r => r.subSector).filter(Boolean))].sort());
  }
}

function updateSelectOptions(filterId, newOptions) {
  const select = qs(`#ef-${filterId}`);
  if (!select) return;

  const currentVal = select.value;
  const label = select.options[0]?.textContent || `All`;

  select.innerHTML = '';
  select.appendChild(h('option', { value: '' }, label));
  for (const o of newOptions) {
    select.appendChild(h('option', { value: o }, o));
  }

  // Restore selection if still valid
  if (currentVal && newOptions.includes(currentVal)) {
    select.value = currentVal;
  } else if (currentVal) {
    delete _filters[filterId];
  }
}

// ─── Save / Load Filters ─────────────────────────

function saveCurrentFilter() {
  if (Object.keys(_filters).length === 0) return;

  const raw = prompt('Save filter as:');
  const name = sanitizeFilename(raw, '').slice(0, 40);
  if (!name) return;

  const saved = loadSavedFilters();
  saved[name] = { ..._filters, _savedAt: new Date().toISOString() };

  try {
    localStorage.setItem(SAVED_FILTERS_KEY, JSON.stringify(saved));
    showToast(`Filter "${name}" saved`);
  } catch { /* quota exceeded — silent */ }
}

function loadSavedFilters() {
  try {
    return safeParseJSON(localStorage.getItem(SAVED_FILTERS_KEY), {}) || {};
  } catch { return {}; }
}

function showSavedFilters() {
  const saved = loadSavedFilters();
  const names = Object.keys(saved);
  if (names.length === 0) {
    showToast('No saved filters');
    return;
  }

  let overlay = qs('#ef-saved-overlay');
  if (overlay) overlay.remove();

  overlay = h('div', { class: 'ef-saved-overlay', id: 'ef-saved-overlay' });
  const modal = h('div', { class: 'ef-saved-modal glass-panel' });

  const header = h('div', { class: 'ef-saved-header' }, [
    h('h3', {}, 'Saved Filters'),
    h('button', {
      class: 'icon-btn',
      'aria-label': 'Close',
      html: '✕',
      onclick: () => overlay.remove(),
    }),
  ]);
  modal.appendChild(header);

  const list = h('div', { class: 'ef-saved-list' });
  for (const name of names) {
    const filterData = { ...saved[name] };
    delete filterData._savedAt;

    const row = h('div', { class: 'ef-saved-row' }, [
      h('div', { class: 'ef-saved-info' }, [
        h('span', { class: 'ef-saved-name' }, name),
        h('span', { class: 'ef-saved-count' }, `${Object.keys(filterData).length} filters`),
      ]),
      h('div', { class: 'ef-saved-actions' }, [
        h('button', {
          class: 'btn btn-primary btn-sm',
          html: 'Apply',
          onclick: () => { applySavedFilter(filterData); overlay.remove(); },
        }),
        h('button', {
          class: 'btn btn-ghost btn-sm',
          html: `${iconHtml('trash')}`,
          onclick: () => { deleteSavedFilter(name); row.remove(); },
        }),
      ]),
    ]);
    list.appendChild(row);
  }

  modal.appendChild(list);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  requestAnimationFrame(() => overlay.classList.add('open'));
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
}

function applySavedFilter(filterData) {
  resetAllFilters();
  _filters = { ...filterData };

  // Restore UI state for each filter
  for (const [key, val] of Object.entries(_filters)) {
    const el = qs(`#ef-${key}`);
    if (el) {
      if (el.tagName === 'SELECT') {
        for (const opt of el.options) {
          if (opt.value === val) { el.value = val; break; }
        }
      } else {
        el.value = val;
      }
    }
    if (key === 'search') {
      const searchInput = qs('#ef-search');
      if (searchInput) searchInput.value = val;
    }
  }

  applyFilters();
}

function deleteSavedFilter(name) {
  const saved = loadSavedFilters();
  delete saved[name];
  try {
    localStorage.setItem(SAVED_FILTERS_KEY, JSON.stringify(saved));
    showToast(`Filter "${name}" deleted`);
  } catch { /* silent */ }
}

// ─── Collapse / Expand ───────────────────────────

function toggleCollapse(section, btn) {
  const grid = qs('.ef-grid', section);
  if (!grid) return;

  const collapsed = grid.classList.toggle('ef-collapsed');
  btn.innerHTML = collapsed
    ? `${iconHtml('chevronDown')} <span>Expand</span>`
    : `${iconHtml('chevronUp')} <span>Collapse</span>`;
}

// ─── Helpers ──────────────────────────────────────

function iconHtml(name) {
  const el = Icon(name);
  const tmp = document.createElement('div');
  tmp.appendChild(el);
  return tmp.innerHTML;
}

function showToast(msg) {
  const host = qs('#toast-host');
  if (!host) return;
  const toast = h('div', { class: 'ef-toast glass-card' }, msg);
  host.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

// ─── Public Init ──────────────────────────────────

export function initFilters() {
  bus.on('data:ready', ({ cache }) => {
    _cache = cache;
    renderFilterBar(cache);
  });
}
