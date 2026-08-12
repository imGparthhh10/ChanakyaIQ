/**
 * companyDirectory.js — Company Directory: numbered, sector-segregated,
 * exportable table.
 *
 * URL: #/directory
 *
 * Distinct from the qualified-only default view used elsewhere — this is
 * a reference/export tool, so it shows every organization in the selected
 * category by default, not just ICP-qualified ones.
 */

import { bus }         from '../utils/eventBus.js';
import { qs, qsa }    from '../utils/dom.js';
import { escapeHTML }  from '../utils/sanitize.js';
import { Icon }        from '../components/icons.js';
import { dataEngine }  from '../data/data.js';
import { hasMinimumData } from '../data/cache.js';
import { isHidingDataSparse } from '../components/filters.js';
import { tierColor, businessIntentBadgeHtml, finalPriorityBadgeHtml } from '../utils/icpBadge.js';
import { loadXLSX }    from '../export/exportLoader.js';
import { downloadBlob, timestampedName } from '../export/formatters.js';
import { toast }       from '../components/toast.js';

function svgIcon(name) {
  const el = Icon(name);
  const tmp = document.createElement('div');
  tmp.appendChild(el);
  return tmp.innerHTML;
}

// [header, recordKey] — drives both the on-screen table and the exported
// .xlsx, so exported columns always match what's visible.
const DIRECTORY_COLUMNS = [
  ['#',                 null],
  ['Company Name',      'companyName'],
  ['Sub-Sector',        'subSector'],
  ['State',             'state'],
  ['City',              'hqCity'],
  ['Revenue (₹ Cr)',    'revenue'],
  ['Employees',         'employeeCount'],
  ['ICP Score',         'icpScore'],
  ['Tier',              'opportunityTier'],
  ['Opportunity Tags',  'opportunityTags'],
  ['Listed Status',     'listedStatus'],
  ['Business Intent',   'businessIntentClassification'],
  ['Final Priority',    'finalPriority'],
];

// Columns meaningful to sort on — '#' is row position, Tags is a list.
const SORTABLE_KEYS = new Set([
  'companyName', 'subSector', 'state', 'hqCity', 'revenue',
  'employeeCount', 'icpScore', 'opportunityTier', 'listedStatus',
  'businessIntentClassification', 'finalPriority',
]);

const TIER_RANK = { Strategic: 5, 'Tier 1': 4, 'Tier 2': 3, 'Tier 3': 2, Watchlist: 1 };

const BUSINESS_INTENT_RANK = { Qualified: 3, Watch: 2, 'Not Qualified': 1, 'Not Scored': 0 };

// backend/src/modules/businessIntent/businessIntent.priority.ts's 6 values,
// ranked so "Hot -- top priority" sorts first — the default sort below.
const FINAL_PRIORITY_RANK = {
  'Hot -- top priority': 6,
  'High potential, needs nurturing': 5,
  'Signal-driven -- worth pursuing despite lower ICP fit': 4,
  'Strategic fit, no signal yet -- outbound trigger candidate': 3,
  'Moderate -- monitor': 2,
  Deprioritize: 1,
};

// Default sort: Business Intent's Step 6 requirement ("Default-sort 'Hot —
// top priority' rows to the top").
let _sort = { key: 'finalPriority', dir: 'desc' };
let _category = '';

function sortValue(r, key) {
  if (key === 'opportunityTier') return TIER_RANK[r.opportunityTier] ?? 0;
  if (key === 'businessIntentClassification') return BUSINESS_INTENT_RANK[r.businessIntentClassification] ?? 0;
  if (key === 'finalPriority') return FINAL_PRIORITY_RANK[r.finalPriority] ?? 0;
  return r[key];
}

function sortRecords(records) {
  const { key, dir } = _sort;
  const mult = dir === 'asc' ? 1 : -1;
  return [...records].sort((a, b) => {
    const av = sortValue(a, key);
    const bv = sortValue(b, key);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;  // nulls sort last regardless of direction
    if (bv == null) return -1;
    if (typeof av === 'string') return av.localeCompare(bv) * mult;
    return (av - bv) * mult;
  });
}

function cellHtml(r, key) {
  switch (key) {
    case 'companyName':
      return `<a class="mt-row-name" href="#/company/${encodeURIComponent(r._dedupeKey)}">${escapeHTML(r.companyName)}</a>`;
    case 'revenue':
      return `<span class="mt-num">${r.revenue != null ? escapeHTML(String(r.revenue)) : '—'}</span>`;
    case 'employeeCount':
      return `<span class="mt-num">${r.employeeCount != null ? Number(r.employeeCount).toLocaleString('en-IN') : '—'}</span>`;
    case 'icpScore':
      return `<span class="mt-num">${r.icpScore != null ? Math.round(r.icpScore) : '—'}</span>`;
    case 'opportunityTier': {
      if (!r.opportunityTier) return '<span class="mt-muted">—</span>';
      const c = tierColor(r.opportunityTier);
      return `<span class="mt-score-chip" style="color:${c};border-color:${c}44">${escapeHTML(r.opportunityTier)}</span>`;
    }
    case 'opportunityTags':
      return (r.opportunityTags || []).length
        ? `<div class="c360-tags">${r.opportunityTags.map(t => `<span class="c360-tag">${escapeHTML(t)}</span>`).join('')}</div>`
        : '<span class="mt-muted">—</span>';
    case 'businessIntentClassification':
      return businessIntentBadgeHtml(r.businessIntentClassification, r.businessIntentScore);
    case 'finalPriority':
      return finalPriorityBadgeHtml(r.finalPriority);
    default:
      return r[key] != null && r[key] !== '' ? escapeHTML(String(r[key])) : '<span class="mt-muted">—</span>';
  }
}

function headerHtml(header, key) {
  if (!key) return `<th>${escapeHTML(header)}</th>`;
  if (!SORTABLE_KEYS.has(key)) return `<th>${escapeHTML(header)}</th>`;
  const active = _sort.key === key;
  const arrow = active ? (_sort.dir === 'asc' ? svgIcon('chevronUp') : svgIcon('chevronDown')) : '';
  return `<th class="cd-dir-th${active ? ' active' : ''}" data-sort-key="${escapeHTML(key)}" role="button" tabindex="0">
    ${escapeHTML(header)} <span class="cd-dir-sort-icon">${arrow}</span>
  </th>`;
}

function renderTable(records) {
  return `
    <table class="mt-table">
      <thead><tr>${DIRECTORY_COLUMNS.map(([h, k]) => headerHtml(h, k)).join('')}</tr></thead>
      <tbody>
        ${records.map((r, i) => `<tr>
          <td class="mt-num">${i + 1}</td>
          ${DIRECTORY_COLUMNS.slice(1).map(([, k]) => `<td>${cellHtml(r, k)}</td>`).join('')}
        </tr>`).join('')}
      </tbody>
    </table>`;
}

function render(container) {
  const cache = dataEngine.cache;
  const raw = cache ? cache.getAll() : [];
  // Directory deliberately ignores isQualified (see file header), but still
  // respects the data-sparse default view via the same toggle used
  // elsewhere -- an org with none of Revenue/IT Spend/Leadership/Allocated
  // Budget on file is hidden here too unless "Show all" has been switched on.
  const all = isHidingDataSparse() ? raw.filter(hasMinimumData) : raw;
  const categories = cache ? cache.categories() : [];

  const filtered = _category ? all.filter(r => r.category === _category) : all;
  const records = sortRecords(filtered);

  container.innerHTML = `
    <div class="page-container">
      <header class="page-header glass-panel">
        <div class="page-header-left">
          <span class="eyebrow">Reference</span>
          <h1 class="page-title">Company Directory</h1>
          <p class="page-sub">${records.length} of ${all.length} organizations${_category ? ` · ${escapeHTML(_category)}` : ''}</p>
        </div>
        <div class="page-header-right" style="display:flex;gap:var(--sp-3);align-items:center">
          <div class="ef-select-wrap" style="min-width:200px">
            <select class="ef-select" id="cd-dir-category">
              <option value="">All Sectors</option>
              ${categories.map(c => `<option value="${escapeHTML(c)}"${c === _category ? ' selected' : ''}>${escapeHTML(c)}</option>`).join('')}
            </select>
            <span class="ef-select-chevron">${svgIcon('chevronDown')}</span>
          </div>
          <button class="btn btn-primary btn-sm" id="cd-dir-export">${svgIcon('download')} Export</button>
        </div>
      </header>

      <section class="glass-panel mt-body" style="overflow-x:auto">
        ${records.length === 0
          ? `<p class="mt-muted" style="padding:var(--sp-6);text-align:center">No organizations match this filter.</p>`
          : renderTable(records)}
      </section>
    </div>`;

  qs('#cd-dir-category', container)?.addEventListener('change', (e) => {
    _category = e.target.value;
    render(container);
  });

  qs('#cd-dir-export', container)?.addEventListener('click', () => exportDirectory(records));

  qsa('.cd-dir-th[data-sort-key]', container).forEach((th) => {
    const key = th.dataset.sortKey;
    const activate = () => {
      _sort = { key, dir: _sort.key === key && _sort.dir === 'desc' ? 'asc' : 'desc' };
      render(container);
    };
    th.addEventListener('click', activate);
    th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } });
  });
}

async function exportDirectory(records) {
  try {
    const XLSX = await loadXLSX();
    const header = DIRECTORY_COLUMNS.map(([h]) => h);
    const rows = records.map((r, i) => DIRECTORY_COLUMNS.map(([, key]) => {
      if (key === null) return i + 1;
      const val = r[key];
      if (key === 'opportunityTags') return (val || []).join(', ');
      return val == null ? '' : val;
    }));
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Directory');
    XLSX.writeFile(wb, timestampedName('ChanakyaIQ_Company_Directory', 'xlsx'));
  } catch (err) {
    toast.error('Export failed', err.message);
  }
}

// ─── Router entry ─────────────────────────────────

export async function mountCompanyDirectory(container) {
  if (!dataEngine.cache) {
    container.innerHTML = `<div class="page-container"><section class="glass-panel"><p style="padding:var(--sp-6);text-align:center;color:var(--text-muted)">Waiting for data engine…</p></section></div>`;
    const off = bus.on('data:ready', () => {
      off();
      mountCompanyDirectory(container);
    });
    return () => off();
  }
  render(container);
  const off = bus.on('data:ready', () => render(container));
  return () => off();
}
