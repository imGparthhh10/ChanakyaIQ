/**
 * icpSection.js — ICP Portfolio section on the Analytics page.
 *
 * Two parts:
 *   1. Tier breakdown — how the scored population splits across the ICP
 *      engine's 5 tiers (backend/src/modules/icp/icp.service.ts).
 *   2. Qualified company table — the organizations that actually passed
 *      qualification, ranked by ICP score.
 *
 * Deliberately pure DOM (no ECharts): a labelled bar breakdown reads better
 * than a chart at this size, and it avoids a second chart-instance lifecycle
 * to manage on a page that already has ~20 of them.
 *
 * Reads the *unfiltered* dataset so the tier split always describes the whole
 * portfolio, independent of whatever the filter bar is currently showing —
 * this section answers "what does our ICP portfolio look like", not "what am
 * I filtered to right now".
 */

import { bus }         from '../utils/eventBus.js';
import { qs }          from '../utils/dom.js';
import { escapeHTML }  from '../utils/sanitize.js';
import { dataEngine }  from '../data/data.js';
import { tierColor }   from '../utils/icpBadge.js';
import { Icon }         from './icons.js';
import { loadXLSX }     from '../export/exportLoader.js';
import { timestampedName } from '../export/formatters.js';
import { toast }        from './toast.js';

// Order matches icp.service.ts's tierForScore() thresholds, best-fit first.
const TIER_ORDER = ['Strategic', 'Tier 1', 'Tier 2', 'Tier 3', 'Watchlist'];
const PAGE_SIZE = 25;

function svgIcon(name) {
  const el = Icon(name);
  const tmp = document.createElement('div');
  tmp.appendChild(el);
  return tmp.innerHTML;
}

// Current page (0-based) and the full qualified+sorted list behind it --
// kept at module scope so the Prev/Next handlers and the Export button
// don't need to re-filter/re-sort the whole dataset on every click, and
// so Export always exports every qualified org, not just the visible page.
let _page = 0;
let _qualified = [];

function tierCounts(records) {
  const counts = new Map(TIER_ORDER.map(t => [t, 0]));
  let unscored = 0;
  for (const r of records) {
    if (r.opportunityTier && counts.has(r.opportunityTier)) {
      counts.set(r.opportunityTier, counts.get(r.opportunityTier) + 1);
    } else {
      unscored++;
    }
  }
  return { counts, unscored };
}

function renderTierBreakdown(records) {
  const { counts, unscored } = tierCounts(records);
  const scored = records.length - unscored;
  const max = Math.max(1, ...counts.values());

  const rows = TIER_ORDER.map((tier) => {
    const n = counts.get(tier);
    const pct = scored ? Math.round((n / scored) * 100) : 0;
    const color = tierColor(tier);
    return `
      <div class="icp-tier-row">
        <span class="icp-tier-name" style="color:${color}">${escapeHTML(tier)}</span>
        <div class="icp-tier-track">
          <div class="icp-tier-fill" style="width:${(n / max) * 100}%;background:${color}"></div>
        </div>
        <span class="icp-tier-count">${n}</span>
        <span class="icp-tier-pct">${pct}%</span>
      </div>`;
  }).join('');

  // Never silently drop unscored orgs from the picture — if the ICP engine
  // hasn't run over part of the dataset, say so rather than implying a 0.
  const note = unscored
    ? `<p class="icp-note">${unscored} of ${records.length} organizations have no ICP tier yet — run <code>POST /api/icp/run</code> to score them.</p>`
    : `<p class="icp-note">All ${records.length} organizations are scored.</p>`;

  return `<div class="icp-tier-list">${rows}</div>${note}`;
}

function renderQualifiedTable() {
  if (!_qualified.length) {
    return `<p class="icp-note">No organizations have passed ICP qualification yet.</p>`;
  }

  const totalPages = Math.max(1, Math.ceil(_qualified.length / PAGE_SIZE));
  _page = Math.min(Math.max(_page, 0), totalPages - 1);

  const start = _page * PAGE_SIZE;
  const shown = _qualified.slice(start, start + PAGE_SIZE);
  const rows = shown.map((r, i) => {
    const color = tierColor(r.opportunityTier);
    return `<tr>
      <td class="mt-num">${start + i + 1}</td>
      <td><a class="mt-row-name" href="#/company/${encodeURIComponent(r._dedupeKey)}">${escapeHTML(r.companyName)}</a></td>
      <td>${r.opportunityTier
        ? `<span class="mt-score-chip" style="color:${color};border-color:${color}44">${escapeHTML(r.opportunityTier)}</span>`
        : '<span class="mt-muted">—</span>'}</td>
      <td class="mt-num">${r.icpScore != null ? Math.round(r.icpScore) : '—'}</td>
      <td class="mt-num">${r.revenue != null ? Number(r.revenue).toLocaleString('en-IN') : '—'}</td>
      <td>${escapeHTML(r.category || '—')}</td>
      <td>${escapeHTML(r.state || '—')}</td>
    </tr>`;
  }).join('');

  return `
    <div class="icp-table-wrap">
      <table class="mt-table">
        <thead><tr>
          <th>#</th><th>Company</th><th>Tier</th><th>ICP Score</th>
          <th>Revenue (₹ Cr)</th><th>Category</th><th>State</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="icp-pager">
      <span class="mt-muted">Page ${_page + 1} of ${totalPages} (${_qualified.length} qualified)</span>
      <div class="icp-pager-btns">
        <button class="btn btn-ghost btn-sm" id="icp-page-prev" ${_page <= 0 ? 'disabled' : ''}>${svgIcon('chevronLeft')} Prev</button>
        <button class="btn btn-ghost btn-sm" id="icp-page-next" ${_page >= totalPages - 1 ? 'disabled' : ''}>Next ${svgIcon('chevronRight')}</button>
      </div>
    </div>`;
}

function renderTablePage() {
  const tableEl = qs('#icp-qualified-table');
  if (!tableEl) return;
  tableEl.innerHTML = renderQualifiedTable();

  qs('#icp-page-prev', tableEl)?.addEventListener('click', () => { _page--; renderTablePage(); });
  qs('#icp-page-next', tableEl)?.addEventListener('click', () => { _page++; renderTablePage(); });
}

const EXPORT_COLUMNS = [
  ['#', null],
  ['Company', 'companyName'],
  ['Tier', 'opportunityTier'],
  ['ICP Score', 'icpScore'],
  ['Revenue (₹ Cr)', 'revenue'],
  ['Category', 'category'],
  ['State', 'state'],
];

// Exports every qualified organization, not just the current page --
// matching how Export works everywhere else in the app (the full
// relevant dataset, independent of on-screen pagination/scroll).
async function exportQualified() {
  if (!_qualified.length) {
    toast.error('Nothing to export', 'No organizations have passed ICP qualification yet.');
    return;
  }
  try {
    const XLSX = await loadXLSX();
    const header = EXPORT_COLUMNS.map(([h]) => h);
    const rows = _qualified.map((r, i) => EXPORT_COLUMNS.map(([, key]) => {
      if (key === null) return i + 1;
      const val = r[key];
      return val == null ? '' : val;
    }));
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'ICP Qualified');
    XLSX.writeFile(wb, timestampedName('ChanakyaIQ_ICP_Qualified', 'xlsx'));
    toast.success('Exported', `${_qualified.length} qualified organizations`);
  } catch (err) {
    toast.error('Export failed', err.message);
  }
}

function render() {
  const tierEl = qs('#icp-tier-breakdown');
  const tableEl = qs('#icp-qualified-table');
  if (!tierEl || !tableEl) return;

  const cache = dataEngine.cache;
  if (!cache) return;
  const records = cache.getAll();

  const qualifiedCount = records.filter(r => r.isQualified === true).length;
  const countEl = qs('#icp-qualified-count');
  if (countEl) {
    countEl.textContent = `${qualifiedCount} of ${records.length} organizations qualified`;
  }

  _qualified = records
    .filter(r => r.isQualified === true)
    .sort((a, b) => (b.icpScore ?? -1) - (a.icpScore ?? -1));
  _page = 0; // fresh data (e.g. after an ICP re-run) starts back at page 1

  tierEl.innerHTML = renderTierBreakdown(records);
  renderTablePage();
}

/** Wired once at boot, like every other analytics component. */
export function initIcpSection() {
  bus.on('data:ready', render);
  if (dataEngine.cache) render();

  qs('#icp-export-btn')?.addEventListener('click', exportQualified);
}
