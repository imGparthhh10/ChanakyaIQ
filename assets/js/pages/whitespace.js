/**
 * whitespace.js — Whitespace Analysis page.
 *
 * URL: #/whitespace
 *
 * Surfaces high-fit accounts that are NOT yet engaged — the sharpest
 * strategic question a sales leader asks: "What are we missing?"
 *
 * Layout:
 *   ┌ Header + strategy filter row (sector / region / min-score)     ┐
 *   ├ 4 summary tiles — TAM, count, avg score, top sector             ┤
 *   ├ Ranked account table — sort by score, one-click Assign-to-me    ┤
 *   └ Whitespace-by-sector breakdown at the bottom                    ┘
 *
 * "Engaged" = status ≠ 'New' OR has an assigned owner. Everything else
 * with opportunity score above the threshold is whitespace.
 */

import { bus }                      from '../utils/eventBus.js';
import { qs, qsa }                 from '../utils/dom.js';
import { escapeHTML }               from '../utils/sanitize.js';
import { announce }                 from '../utils/a11y.js';
import { CleanupRegistry, debounce }from '../utils/perf.js';
import { Icon }                     from '../components/icons.js';
import { dataEngine }               from '../data/data.js';
import { tierBadgeHtml }            from '../utils/icpBadge.js';
import { workspace }                from '../workspace/store.js';
import { territory }                from '../workspace/territory.js';
import { currentUser }              from '../data/authClient.js';
import { opportunityValue, scoreTier } from '../workspace/scoring.js';

function svgIcon(name) {
  const el = Icon(name);
  const tmp = document.createElement('div');
  tmp.appendChild(el);
  return tmp.innerHTML;
}

function fmt(n) {
  if (n == null || n === 0) return '—';
  if (n >= 1000) return '₹' + (n / 1000).toFixed(1) + 'K Cr';
  return '₹' + Number(n).toFixed(1) + ' Cr';
}

// ─── Compute whitespace ───────────────────────────

function isEngaged(rec) {
  const status = workspace.getStatus(rec._dedupeKey);
  const owner  = territory.ownerOf(rec._dedupeKey);
  return owner != null || (status && status !== 'New');
}

function computeWhitespace(cache, opts) {
  const { sector, region, minScore } = opts;
  const out = [];
  for (const rec of cache.getAll()) {
    if (isEngaged(rec)) continue;
    if (sector && rec.category !== sector) continue;
    if (region && rec.region   !== region) continue;
    const s = opportunityValue(rec);
    if (s < minScore) continue;
    out.push({ rec, score: s });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

function summarize(items) {
  let tam = 0, sum = 0;
  const bySector = {};
  for (const { rec, score } of items) {
    tam += (rec.buyingPotential || 0);
    sum += score;
    const sec = rec.category || 'Other';
    if (!bySector[sec]) bySector[sec] = { count: 0, tam: 0 };
    bySector[sec].count++;
    bySector[sec].tam += (rec.buyingPotential || 0);
  }
  const topSector = Object.entries(bySector).sort((a, b) => b[1].tam - a[1].tam)[0];
  return {
    count: items.length,
    tam,
    avg: items.length ? Math.round(sum / items.length) : 0,
    topSector: topSector ? topSector[0] : '—',
    bySector,
  };
}

// ─── Render ───────────────────────────────────────

function render(container, opts) {
  const cache = dataEngine.cache;
  if (!cache) {
    container.innerHTML = `<div class="page-container"><section class="glass-panel"><p style="padding:var(--sp-6);text-align:center;color:var(--text-muted)">Waiting for data engine…</p></section></div>`;
    return () => {};
  }

  const items = computeWhitespace(cache, opts);
  const s = summarize(items);

  const sectorOpts = ['', ...cache.categories()];
  const regionOpts = ['', ...cache.regions()];

  container.innerHTML = `
    <div class="page-container ws-page">
      <header class="page-header glass-panel">
        <div class="page-header-left">
          <span class="eyebrow">Strategic</span>
          <h1 class="page-title">Whitespace Analysis</h1>
          <p class="page-sub">High-fit accounts that are neither owned nor engaged. Fixed order: highest opportunity first.</p>
        </div>
        <div class="page-header-right ws-controls">
          <label class="ws-ctl">
            <span>Sector</span>
            <select id="ws-sector" class="ws-select">
              ${sectorOpts.map(o => `<option value="${escapeHTML(o)}"${o === opts.sector ? ' selected' : ''}>${o || 'All sectors'}</option>`).join('')}
            </select>
          </label>
          <label class="ws-ctl">
            <span>Region</span>
            <select id="ws-region" class="ws-select">
              ${regionOpts.map(o => `<option value="${escapeHTML(o)}"${o === opts.region ? ' selected' : ''}>${o || 'All regions'}</option>`).join('')}
            </select>
          </label>
          <label class="ws-ctl">
            <span>Min score</span>
            <select id="ws-minscore" class="ws-select">
              ${[0, 20, 40, 60, 80].map(n => `<option value="${n}"${n === opts.minScore ? ' selected' : ''}>${n === 0 ? 'Any' : n + '+'}</option>`).join('')}
            </select>
          </label>
        </div>
      </header>

      <section class="ws-kpi-row">
        <div class="glass-panel exec-tile exec-tile-primary"><div class="exec-tile-head"><span class="exec-tile-label">Whitespace TAM</span></div><div class="exec-tile-value">${fmt(s.tam)}</div><div class="exec-tile-sub">Addressable, not engaged</div></div>
        <div class="glass-panel exec-tile"><div class="exec-tile-head"><span class="exec-tile-label">Accounts</span></div><div class="exec-tile-value">${s.count.toLocaleString('en-IN')}</div><div class="exec-tile-sub">Meeting current filters</div></div>
        <div class="glass-panel exec-tile exec-tile-positive"><div class="exec-tile-head"><span class="exec-tile-label">Avg score</span></div><div class="exec-tile-value">${s.avg}</div><div class="exec-tile-sub">Opportunity score</div></div>
        <div class="glass-panel exec-tile exec-tile-warn"><div class="exec-tile-head"><span class="exec-tile-label">Top sector</span></div><div class="exec-tile-value ws-tile-text">${escapeHTML(s.topSector)}</div><div class="exec-tile-sub">Largest whitespace pool</div></div>
      </section>

      <section class="glass-panel ws-body">
        ${items.length === 0 ? `
          <div class="ws-empty">
            <div class="ws-empty-icon">${svgIcon('checkCircle')}</div>
            <h3>No whitespace at this threshold</h3>
            <p>Every matching account is already owned or engaged. Lower the score threshold, or clear the sector/region filters.</p>
          </div>
        ` : `
          <div class="ws-toolbar">
            <span class="ws-toolbar-label">Showing top ${Math.min(items.length, 100)} of ${items.length.toLocaleString('en-IN')}</span>
            <button class="btn btn-primary btn-sm" id="ws-bulk-assign">${svgIcon('plus')} Assign top 10 to me</button>
          </div>
          <table class="ws-table">
            <thead>
              <tr>
                <th class="ws-col-rank">#</th>
                <th>Company</th>
                <th>Sector</th>
                <th>Location</th>
                <th class="mt-num">Score</th>
                <th class="mt-num">TAM</th>
                <th>ICP Tier</th>
                <th>Rationale</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${items.slice(0, 100).map((it, i) => renderRow(it, i)).join('')}
            </tbody>
          </table>
        `}
      </section>

      ${items.length > 0 ? renderSectorBreakdown(s.bySector) : ''}
    </div>`;

  const cleanup = new CleanupRegistry();

  const update = debounce(() => {
    const next = {
      sector: qs('#ws-sector', container).value,
      region: qs('#ws-region', container).value,
      minScore: Number(qs('#ws-minscore', container).value),
    };
    render(container, next);
  }, 60);

  ['#ws-sector', '#ws-region', '#ws-minscore'].forEach(sel => {
    const el = qs(sel, container);
    if (el) cleanup.addListener(el, 'change', update);
  });

  qsa('.ws-assign-me', container).forEach(btn => {
    cleanup.addListener(btn, 'click', () => {
      territory.assignToMe(btn.dataset.key);
      announce('Assigned to your book.', 'polite');
      render(container, opts);
    });
  });

  const bulk = qs('#ws-bulk-assign', container);
  if (bulk) {
    cleanup.addListener(bulk, 'click', () => {
      const top10 = items.slice(0, 10).map(it => it.rec._dedupeKey);
      const uid   = currentUser()?.id;
      if (!uid) return;
      territory.bulkAssign(top10, uid);
      announce(`Assigned top ${top10.length} to your book.`, 'polite');
      render(container, opts);
    });
  }

  cleanup.add(bus.on('territory:change', () => render(container, opts)));
  cleanup.add(bus.on('workspace:status:change', () => render(container, opts)));
  cleanup.add(bus.on('auth:change', () => render(container, opts)));

  return () => cleanup.dispose();
}

function renderRow(item, i) {
  const r = item.rec;
  const tier = scoreTier(item.score);
  const rationale = buildRationale(r);
  return `<tr>
    <td class="ws-col-rank">${i + 1}</td>
    <td><a class="mt-row-name" href="#/company/${encodeURIComponent(r._dedupeKey)}">${escapeHTML(r.companyName)}</a></td>
    <td class="mt-muted">${escapeHTML(r.category || '—')}</td>
    <td class="mt-muted">${escapeHTML([r.hqCity, r.state].filter(Boolean).join(', ') || '—')}</td>
    <td class="mt-num"><span class="mt-score-chip" style="color:${tier.color};border-color:${tier.color}44">${item.score}</span></td>
    <td class="mt-num">${escapeHTML(fmt(r.buyingPotential))}</td>
    <td>${tierBadgeHtml(r.opportunityTier, r.icpScore)}</td>
    <td class="ws-rationale">${escapeHTML(rationale)}</td>
    <td>
      <button class="btn btn-ghost btn-sm ws-assign-me" data-key="${escapeHTML(r._dedupeKey)}">${svgIcon('plus')} Add to me</button>
    </td>
  </tr>`;
}

function buildRationale(r) {
  const bits = [];
  if (r.buyingPotential >= 50)          bits.push(`₹${r.buyingPotential} Cr wallet`);
  if (r.cloudMaturity === 'Low')        bits.push('Cloud runway');
  if (r.cyberMaturity === 'Low')        bits.push('Cyber uplift');
  if (r.aiReadiness === 'Low' && (r.revenue || 0) > 500) bits.push('Greenfield AI');
  if (r.painPoints)                     bits.push('Documented pain');
  if (r.initiatives)                    bits.push('Active initiatives');
  return bits.slice(0, 3).join(' · ') || 'Passes score threshold';
}

function renderSectorBreakdown(bySector) {
  const rows = Object.entries(bySector).sort((a, b) => b[1].tam - a[1].tam).slice(0, 10);
  const maxTam = Math.max(...rows.map(r => r[1].tam), 1);
  return `
    <section class="glass-panel ws-breakdown">
      <div class="exec-panel-head">
        <h3 class="exec-panel-title">${svgIcon('layers')} Whitespace by Sector</h3>
      </div>
      <div class="exec-rank-list">
        ${rows.map(([sec, v]) => {
          const pct = Math.max((v.tam / maxTam) * 100, 4);
          return `<div class="exec-rank-row">
            <span class="exec-rank-name">${escapeHTML(sec)}</span>
            <div class="exec-rank-bar-wrap"><div class="exec-rank-bar" style="width:${pct}%;background:#F59E0B"></div></div>
            <span class="exec-rank-tam">${fmt(v.tam)}</span>
            <span class="exec-rank-count">${v.count} co</span>
          </div>`;
        }).join('')}
      </div>
    </section>`;
}

// ─── Router entry ─────────────────────────────────

export async function mountWhitespace(container) {
  if (!dataEngine.cache) {
    container.innerHTML = `<div class="page-container"><section class="glass-panel"><p style="padding:var(--sp-6);text-align:center;color:var(--text-muted)">Waiting for data engine…</p></section></div>`;
    const off = bus.on('data:ready', () => { off(); mountWhitespace(container); });
    return () => off();
  }
  return render(container, { sector: '', region: '', minScore: 40 });
}
