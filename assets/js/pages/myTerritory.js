/**
 * myTerritory.js — "My Book" — accounts owned by the logged-in user.
 *
 * URL: #/my-territory
 *
 * Auto-filtered to accounts assigned to identity.current(). Not a
 * static filter — reflects any territory assignments made from
 * Company 360 or bulk actions in real time via `territory:change`.
 *
 * Layout:
 *   ┌ Header: My Book · <N> accounts · Pipeline TAM · Hot leads ┐
 *   ├ Status summary (chips: New 4 · Researching 2 · …)         ┤
 *   └ Account table with score, status, signals, quick actions   ┘
 */

import { bus }                       from '../utils/eventBus.js';
import { qs, qsa }                  from '../utils/dom.js';
import { escapeHTML }                from '../utils/sanitize.js';
import { announce }                  from '../utils/a11y.js';
import { CleanupRegistry }           from '../utils/perf.js';
import { Icon }                      from '../components/icons.js';
import { dataEngine }                from '../data/data.js';
import { workspace }                 from '../workspace/store.js';
import { territory }                 from '../workspace/territory.js';
import { identity }                  from '../workspace/identity.js';
import { opportunityValue, scoreTier } from '../workspace/scoring.js';
import { deriveSignalTypes }         from '../workspace/signals.js';

function svgIcon(name) {
  const el = Icon(name);
  const tmp = document.createElement('div');
  tmp.appendChild(el);
  return tmp.innerHTML;
}

function fmt(n) {
  if (n == null) return '—';
  if (n >= 1000) return '₹' + (n / 1000).toFixed(1) + 'K Cr';
  return '₹' + Number(n).toFixed(1) + ' Cr';
}

function statusColor(s) {
  return ({
    'New':         '#64748B',
    'Researching': '#6366F1',
    'Contacted':   '#22D3EE',
    'Qualified':   '#10B981',
    'Won':         '#059669',
    'Lost':        '#EF4444',
    'DQ':          '#94A3B8',
  })[s] || '#64748B';
}

// ─── Summary ──────────────────────────────────────

function summarize(records) {
  let tam = 0, hot = 0, sumScore = 0;
  const byStatus = {};
  for (const rec of records) {
    tam += (rec.buyingPotential || 0);
    const s = opportunityValue(rec);
    sumScore += s;
    if (s >= 65) hot++;
    const st = workspace.getStatus(rec._dedupeKey);
    byStatus[st] = (byStatus[st] || 0) + 1;
  }
  return {
    count: records.length,
    tam, hot,
    avgScore: records.length ? Math.round(sumScore / records.length) : 0,
    byStatus,
  };
}

// ─── Render ───────────────────────────────────────

function render(container) {
  const cache = dataEngine.cache;
  const user  = identity.current();

  if (!user) {
    container.innerHTML = `<div class="page-container"><section class="glass-panel">No active user selected.</section></div>`;
    return () => {};
  }

  const records = cache ? territory.myBook(cache) : [];
  records.sort((a, b) => opportunityValue(b) - opportunityValue(a));

  const s = summarize(records);

  container.innerHTML = `
    <div class="page-container mt-page">
      <header class="page-header glass-panel">
        <div class="page-header-left">
          <span class="eyebrow">My Book</span>
          <h1 class="page-title">${escapeHTML(user.name.split(' ')[0])}'s Territory</h1>
          <p class="page-sub">${s.count} accounts assigned · ${escapeHTML(user.role)}</p>
        </div>
        <div class="page-header-right mt-summary">
          <div class="mt-summary-tile">
            <span class="mt-summary-label">Pipeline TAM</span>
            <span class="mt-summary-value">${fmt(s.tam)}</span>
          </div>
          <div class="mt-summary-tile">
            <span class="mt-summary-label">Hot leads</span>
            <span class="mt-summary-value">${s.hot}</span>
          </div>
          <div class="mt-summary-tile">
            <span class="mt-summary-label">Avg score</span>
            <span class="mt-summary-value">${s.avgScore}</span>
          </div>
        </div>
      </header>

      <section class="glass-panel mt-status-bar">
        ${workspace.STATUS_VALUES.map(st => {
          const c = s.byStatus[st] || 0;
          return `<div class="mt-status-chip">
            <span class="mt-status-dot" style="background:${statusColor(st)}"></span>
            <span class="mt-status-label">${escapeHTML(st)}</span>
            <span class="mt-status-count">${c}</span>
          </div>`;
        }).join('')}
      </section>

      <section class="glass-panel mt-body">
        ${records.length === 0
          ? renderEmpty(user)
          : renderTable(records)}
      </section>
    </div>`;

  const cleanup = new CleanupRegistry();

  // Add-to-me suggestions row wiring
  qsa('[data-mt-assignme]', container).forEach(btn => {
    cleanup.addListener(btn, 'click', () => {
      territory.assignToMe(btn.dataset.mtAssignme);
      announce('Account added to your territory.', 'polite');
      render(container);
    });
  });

  // Row status change
  qsa('.mt-row-status', container).forEach(sel => {
    cleanup.addListener(sel, 'change', (e) => {
      workspace.setStatus(sel.dataset.key, e.target.value);
    });
  });

  // Row unassign
  qsa('[data-mt-unassign]', container).forEach(btn => {
    cleanup.addListener(btn, 'click', () => {
      territory.assign(btn.dataset.mtUnassign, null);
    });
  });

  // Re-render on any change that affects book membership
  cleanup.add(bus.on('territory:change', () => render(container)));
  cleanup.add(bus.on('identity:change',  () => render(container)));
  cleanup.add(bus.on('workspace:status:change', () => render(container)));

  return () => cleanup.dispose();
}

function renderEmpty(user) {
  const cache = dataEngine.cache;
  const suggestions = cache
    ? cache.getAll()
        .filter(r => !territory.ownerOf(r._dedupeKey))
        .sort((a, b) => opportunityValue(b) - opportunityValue(a))
        .slice(0, 8)
    : [];

  return `
    <div class="mt-empty">
      <div class="mt-empty-icon">${svgIcon('target')}</div>
      <h3>No accounts assigned yet</h3>
      <p>Assign accounts to <b>${escapeHTML(user.name)}</b> from any Company 360 page, or pick from the high-priority prospects below.</p>
      ${suggestions.length === 0 ? '' : `
        <div class="mt-suggestions">
          <div class="mt-suggestions-title">Suggested — top unassigned prospects</div>
          ${suggestions.map(r => `<div class="mt-sug-row">
            <a class="mt-sug-name" href="#/company/${encodeURIComponent(r._dedupeKey)}">${escapeHTML(r.companyName)}</a>
            <span class="mt-sug-meta">${escapeHTML([r.category, r.state].filter(Boolean).join(' · '))}</span>
            <span class="mt-sug-score" style="color:${scoreTier(opportunityValue(r)).color}">${opportunityValue(r)}</span>
            <button class="btn btn-ghost btn-sm" data-mt-assignme="${escapeHTML(r._dedupeKey)}">${svgIcon('plus')} Add to my book</button>
          </div>`).join('')}
        </div>
      `}
    </div>`;
}

function renderTable(records) {
  return `
    <table class="mt-table">
      <thead>
        <tr>
          <th>Company</th>
          <th>Sector</th>
          <th>Location</th>
          <th class="mt-num">Score</th>
          <th class="mt-num">TAM</th>
          <th>Status</th>
          <th>Signals</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${records.map(r => renderRow(r)).join('')}
      </tbody>
    </table>`;
}

function renderRow(r) {
  const key = r._dedupeKey;
  const score = opportunityValue(r);
  const tier = scoreTier(score);
  const status = workspace.getStatus(key);
  const signals = [...deriveSignalTypes(r)];

  return `<tr>
    <td>
      <a class="mt-row-name" href="#/company/${encodeURIComponent(key)}">${escapeHTML(r.companyName)}</a>
    </td>
    <td class="mt-muted">${escapeHTML(r.category || '—')}</td>
    <td class="mt-muted">${escapeHTML([r.hqCity, r.state].filter(Boolean).join(', ') || '—')}</td>
    <td class="mt-num">
      <span class="mt-score-chip" style="color:${tier.color};border-color:${tier.color}44">${score}</span>
    </td>
    <td class="mt-num">${escapeHTML(fmt(r.buyingPotential))}</td>
    <td>
      <select class="mt-row-status" data-key="${escapeHTML(key)}" aria-label="Status for ${escapeHTML(r.companyName)}">
        ${workspace.STATUS_VALUES.map(s => `<option value="${s}"${s === status ? ' selected' : ''}>${s}</option>`).join('')}
      </select>
    </td>
    <td>
      <div class="mt-signals">
        ${signals.length === 0 ? '<span class="mt-muted">—</span>' : signals.map(t => `<span class="mt-signal mt-signal-${t}">${escapeHTML(t)}</span>`).join('')}
      </div>
    </td>
    <td>
      <button class="icon-btn mt-unassign" data-mt-unassign="${escapeHTML(key)}" aria-label="Unassign" title="Unassign from me">✕</button>
    </td>
  </tr>`;
}

// ─── Router entry ─────────────────────────────────

export async function mountMyTerritory(container) {
  if (!dataEngine.cache) {
    container.innerHTML = `<div class="page-container"><section class="glass-panel"><p style="padding:var(--sp-6);text-align:center;color:var(--text-muted)">Waiting for data engine…</p></section></div>`;
    const off = bus.on('data:ready', () => {
      off();
      mountMyTerritory(container);
    });
    return () => off();
  }
  return render(container);
}
