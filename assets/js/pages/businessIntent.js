/**
 * businessIntent.js — Business Intent Engine admin page: run trigger
 * (dry-run gated before real run) + Removed Organizations audit panel.
 *
 * URL: #/settings/business-intent
 *
 * No sidebar nav entry, matching icpSettings.js's own precedent (a hidden
 * admin URL, not a discoverable nav item) — cross-linked with icpSettings.js
 * instead so the two admin pages can reach each other.
 *
 * Safety gate (spec: "Do not enable automatic/scheduled runs until a human
 * has reviewed at least one dry-run output"): the real-run button stays
 * disabled until a dry-run has been executed and its results displayed at
 * least once in this page session, and a real run additionally requires an
 * explicit confirm() naming exactly how many organizations will be
 * archived — there is no way to trigger a real run without first seeing a
 * dry-run preview.
 */

import { escapeHTML } from '../utils/sanitize.js';
import { Icon } from '../components/icons.js';
import { toast } from '../components/toast.js';
import { API_BASE } from '../data/data.js';
import { authFetch } from '../data/authClient.js';
import { dataEngine } from '../data/data.js';
import { businessIntentBadgeHtml } from '../utils/icpBadge.js';

function svgIcon(name) {
  const el = Icon(name);
  const tmp = document.createElement('div');
  tmp.appendChild(el);
  return tmp.innerHTML;
}

let _dryRunDone = false;
let _lastDryRunSummary = null;
let _removalsPage = 1;
const REMOVALS_PAGE_SIZE = 25;

function summaryHtml(summary) {
  const rows = [
    ['Organizations scored', summary.organizationsScored],
    ['Qualified', summary.qualified],
    ['Watch', summary.watch],
    ['Not Qualified', summary.notQualified],
    ['Excluded (hard filters)', summary.excluded],
    [summary.dryRun ? 'Would be archived' : 'Archived', summary.archivalCandidates.length],
  ];
  return `
    <div class="c360-stat-grid" style="margin-bottom:var(--sp-4)">
      ${rows.map(([label, value]) => `
        <div class="c360-stat-tile">
          <span class="c360-stat-label">${escapeHTML(label)}</span>
          <span class="c360-stat-value">${escapeHTML(String(value))}</span>
        </div>`).join('')}
    </div>
    ${summary.archivalCandidates.length ? `
      <div style="max-height:320px;overflow-y:auto;border:1px solid var(--border-2);border-radius:var(--r-md)">
        <table class="mt-table">
          <thead><tr><th>Company</th><th>BI Score</th><th>ICP Tier</th><th>Reason</th></tr></thead>
          <tbody>
            ${summary.archivalCandidates.map(c => `
              <tr>
                <td>${escapeHTML(c.organizationName)}</td>
                <td class="mt-num">${escapeHTML(String(c.businessIntentScore))}</td>
                <td>${escapeHTML(c.icpTier || '—')}</td>
                <td class="mt-muted">${escapeHTML(c.reason)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>` : '<p class="mt-muted">No organizations meet the archival criteria.</p>'}
  `;
}

async function runEngine(container, dryRun) {
  const resultsEl = container.querySelector('#bi-results');
  const dryRunBtn = container.querySelector('#bi-dry-run');
  const realRunBtn = container.querySelector('#bi-real-run');

  if (!dryRun) {
    const count = _lastDryRunSummary?.archivalCandidates.length ?? 0;
    const proceed = window.confirm(
      `This will permanently soft-delete (status -> REJECTED) ${count} organization(s) based on the ` +
      `most recent dry-run. This is not easily reversible from the UI. Continue?`
    );
    if (!proceed) return;
  }

  dryRunBtn.disabled = true;
  realRunBtn.disabled = true;
  resultsEl.innerHTML = `<p class="mt-muted" style="padding:var(--sp-4);text-align:center">Running…</p>`;

  try {
    const resp = await authFetch(`${API_BASE}/business-intent/run${dryRun ? '?dryRun=true' : ''}`, { method: 'POST' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const summary = await resp.json();

    resultsEl.innerHTML = summaryHtml(summary);

    if (dryRun) {
      _dryRunDone = true;
      _lastDryRunSummary = summary;
      realRunBtn.disabled = false;
      toast.success('Dry-run complete', `${summary.archivalCandidates.length} organization(s) would be archived. Review before running for real.`);
    } else {
      toast.success('Business Intent run complete', `${summary.archived} organization(s) archived. Refreshing dashboard data…`);
      // Cache invalidation, verified: the same action that ran the engine
      // also forces a real re-fetch of GET /organizations, so every open
      // dashboard view picks up the new scores/badges and the archived
      // orgs dropping out of the default view -- not just theoretically
      // wired, actually called here.
      await dataEngine.reload();
      _dryRunDone = false; // require a fresh dry-run before the next real run
      _lastDryRunSummary = null;
      realRunBtn.disabled = true;
    }
  } catch (err) {
    resultsEl.innerHTML = `<p class="mt-muted" style="padding:var(--sp-4);text-align:center">Run failed: ${escapeHTML(err.message)}</p>`;
    toast.error('Run failed', err.message);
  } finally {
    dryRunBtn.disabled = false;
  }
}

async function loadRemovals(page) {
  const resp = await authFetch(`${API_BASE}/business-intent/removals?page=${page}&pageSize=${REMOVALS_PAGE_SIZE}`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

function removalsTableHtml(data) {
  if (!data.rows.length) {
    return '<p class="mt-muted" style="padding:var(--sp-4);text-align:center">No organizations have been archived yet.</p>';
  }
  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return `
    <table class="mt-table">
      <thead><tr><th>Company</th><th>BI Score / Class</th><th>ICP Score / Tier</th><th>Reason</th><th>Removed At</th></tr></thead>
      <tbody>
        ${data.rows.map(r => `
          <tr>
            <td>${escapeHTML(r.organizationName)}</td>
            <td>${businessIntentBadgeHtml(r.businessIntentClassification.replace(/_/g, ' '), r.businessIntentScore)}</td>
            <td>${r.icpScore != null ? escapeHTML(String(r.icpScore)) : '—'} / ${escapeHTML(r.icpTier || '—')}</td>
            <td class="mt-muted">${escapeHTML(r.reason)}</td>
            <td class="mt-muted">${new Date(r.removedAt).toLocaleString('en-IN')}</td>
          </tr>`).join('')}
      </tbody>
    </table>
    <div style="display:flex;justify-content:space-between;align-items:center;padding:var(--sp-3) 0">
      <span class="mt-muted">Page ${data.page} of ${totalPages} (${data.total} total)</span>
      <div style="display:flex;gap:var(--sp-2)">
        <button class="btn btn-ghost btn-sm" id="bi-removals-prev" ${data.page <= 1 ? 'disabled' : ''}>${svgIcon('chevronLeft')} Prev</button>
        <button class="btn btn-ghost btn-sm" id="bi-removals-next" ${data.page >= totalPages ? 'disabled' : ''}>Next ${svgIcon('chevronRight')}</button>
      </div>
    </div>`;
}

async function renderRemovalsPanel(container) {
  const el = container.querySelector('#bi-removals-panel');
  el.innerHTML = `<p class="mt-muted" style="padding:var(--sp-4);text-align:center">Loading…</p>`;
  try {
    const data = await loadRemovals(_removalsPage);
    el.innerHTML = removalsTableHtml(data);
    el.querySelector('#bi-removals-prev')?.addEventListener('click', () => { _removalsPage--; renderRemovalsPanel(container); });
    el.querySelector('#bi-removals-next')?.addEventListener('click', () => { _removalsPage++; renderRemovalsPanel(container); });
  } catch (err) {
    el.innerHTML = `<p class="mt-muted" style="padding:var(--sp-4);text-align:center">Couldn't load removals: ${escapeHTML(err.message)}</p>`;
  }
}

export async function mountBusinessIntent(container) {
  container.innerHTML = `
    <div class="page-container">
      <header class="page-header glass-panel">
        <div class="page-header-left">
          <span class="eyebrow">Administration</span>
          <h1 class="page-title">Business Intent Engine</h1>
          <p class="page-sub">MEDDPICC-derived qualification, scored from data already on file. See <a href="#/settings/icp">ICP Qualification Rules</a> for the tier engine this cross-references.</p>
        </div>
      </header>

      <section class="c360-panel glass-panel">
        <h3 class="c360-panel-title">${svgIcon('target')} Run Engine</h3>
        <p class="mt-muted" style="margin-bottom:var(--sp-4)">
          Always run a dry-run first and review the results below — a real run archives
          (status → REJECTED, not deleted) every organization that fails both Business Intent
          and ICP qualification. The real-run button stays disabled until a fresh dry-run has
          been reviewed.
        </p>
        <div style="display:flex;gap:var(--sp-3);margin-bottom:var(--sp-4)">
          <button class="btn btn-ghost" id="bi-dry-run">${svgIcon('refresh')} Run Dry-Run</button>
          <button class="btn btn-primary" id="bi-real-run" disabled>${svgIcon('checkCircle')} Run For Real</button>
        </div>
        <div id="bi-results"></div>
      </section>

      <section class="c360-panel glass-panel">
        <h3 class="c360-panel-title">${svgIcon('alertCircle')} Removed Organizations</h3>
        <p class="mt-muted" style="margin-bottom:var(--sp-4)">
          Audit trail of every organization archived by this engine — these stay visible here
          even though they no longer appear in the main dashboard views.
        </p>
        <div id="bi-removals-panel" style="overflow-x:auto"></div>
      </section>
    </div>`;

  container.querySelector('#bi-dry-run').addEventListener('click', () => runEngine(container, true));
  container.querySelector('#bi-real-run').addEventListener('click', () => runEngine(container, false));

  await renderRemovalsPanel(container);
  return () => {};
}
