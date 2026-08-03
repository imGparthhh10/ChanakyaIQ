/**
 * executive.js — Executive Dashboard page.
 *
 * URL: #/executive
 *
 * Read-only leadership surface. No filter bar. Every tile answers
 * "should I care about anything today?" in ≤ 15 seconds, and has
 * a Drill-in link that hands off to the operational surface with
 * the appropriate filter pre-applied.
 *
 * Row 1 — TAM & Coverage (5 KPI tiles)
 * Row 2 — Where the opportunity lives (sector ranking + state ranking)
 * Row 3 — What changed this week (Signals + Score movers)
 * Row 4 — ESDS product coverage
 * Row 5 — Data health
 */

import { bus }                       from '../utils/eventBus.js';
import { qs, qsa }                  from '../utils/dom.js';
import { escapeHTML }                from '../utils/sanitize.js';
import { CleanupRegistry }           from '../utils/perf.js';
import { Icon }                      from '../components/icons.js';
import { dataEngine }                from '../data/data.js';
import { workspace }                 from '../workspace/store.js';
import { territory }                 from '../workspace/territory.js';
import { identity }                  from '../workspace/identity.js';
import { opportunityValue, scoreTier, confidenceScore } from '../workspace/scoring.js';
import { topMovers }                 from '../workspace/scoreHistory.js';
import { deriveSignalTypes }         from '../workspace/signals.js';
import { generateStrategySummary }   from '../recommendations/engine.js';
import { navigate }                  from '../router.js';

function svgIcon(name) {
  const el = Icon(name);
  const tmp = document.createElement('div');
  tmp.appendChild(el);
  return tmp.innerHTML;
}

function fmt(n) {
  if (n == null) return '—';
  if (n >= 100000) return '₹' + (n / 100000).toFixed(1) + 'L Cr';
  if (n >= 1000)   return '₹' + (n / 1000).toFixed(1) + 'K Cr';
  return '₹' + Number(n).toFixed(0) + ' Cr';
}

function fmtNum(n) {
  if (n == null) return '—';
  return Number(n).toLocaleString('en-IN');
}

function fmtPct(n) {
  if (n == null) return '—';
  return Math.round(n) + '%';
}

// ─── Aggregations ─────────────────────────────────

function computeExec(cache) {
  const all = cache.getAll();
  const total = all.length;

  let pipelineTAM = 0;
  let whitespaceTAM = 0;
  let ownedCount    = 0;
  let hotLeads      = 0;
  let sumConfidence = 0;
  let engagedCount  = 0;

  const bySector = {};
  const byState  = {};

  for (const rec of all) {
    const score = opportunityValue(rec);
    const owner = territory.ownerOf(rec._dedupeKey);
    const status = workspace.getStatus(rec._dedupeKey);
    const bp = rec.buyingPotential || 0;
    const engaged = status && status !== 'New';

    pipelineTAM += bp;
    if (!engaged && score >= 40) whitespaceTAM += bp;
    if (owner) ownedCount++;
    if (score >= 65) hotLeads++;
    sumConfidence += confidenceScore(rec);
    if (engaged) engagedCount++;

    // Sector rollup
    const sec = rec.category || 'Other';
    if (!bySector[sec]) bySector[sec] = { count: 0, tam: 0, sumScore: 0 };
    bySector[sec].count++;
    bySector[sec].tam += bp;
    bySector[sec].sumScore += score;

    // State rollup
    const st = rec.state || 'Unknown';
    if (!byState[st]) byState[st] = { count: 0, tam: 0, sumScore: 0 };
    byState[st].count++;
    byState[st].tam += bp;
    byState[st].sumScore += score;
  }

  const avgConfidence = total ? sumConfidence / total : 0;
  const coverage = total ? (ownedCount / total) * 100 : 0;

  const sectorRank = Object.entries(bySector)
    .map(([name, v]) => ({ name, ...v, avg: v.count ? v.sumScore / v.count : 0 }))
    .sort((a, b) => b.tam - a.tam)
    .slice(0, 8);

  const stateRank = Object.entries(byState)
    .map(([name, v]) => ({ name, ...v, avg: v.count ? v.sumScore / v.count : 0 }))
    .sort((a, b) => b.tam - a.tam)
    .slice(0, 8);

  return {
    total, pipelineTAM, whitespaceTAM, ownedCount, hotLeads,
    avgConfidence, coverage, engagedCount,
    sectorRank, stateRank,
  };
}

// ─── Row 1: KPI tiles ─────────────────────────────

function tile(label, value, sub, drillHref, tone = 'default') {
  return `<a class="exec-tile glass-card exec-tile-${tone}" ${drillHref ? `href="${drillHref}"` : ''}>
    <div class="exec-tile-head">
      <span class="exec-tile-label">${escapeHTML(label)}</span>
      ${drillHref ? `<span class="exec-tile-drill">${svgIcon('chevronRight')}</span>` : ''}
    </div>
    <div class="exec-tile-value">${value}</div>
    ${sub ? `<div class="exec-tile-sub">${sub}</div>` : ''}
  </a>`;
}

function renderKPIs(x) {
  return `
    <section class="exec-kpi-row" aria-label="Executive KPIs">
      ${tile('Pipeline TAM',    fmt(x.pipelineTAM),      `${x.total} companies in book`,           '#/', 'primary')}
      ${tile('Whitespace TAM',  fmt(x.whitespaceTAM),    'Addressable but not yet engaged',        '#/whitespace', 'warn')}
      ${tile('Coverage',        fmtPct(x.coverage),      `${fmtNum(x.ownedCount)} of ${fmtNum(x.total)} assigned`, '#/my-territory')}
      ${tile('Hot Leads',       fmtNum(x.hotLeads),      'Opportunity score ≥ 65',                 '#/', 'positive')}
      ${tile('Data Quality',    fmtPct(x.avgConfidence), 'Median record completeness',             '#/')}
    </section>`;
}

// ─── Row 2: Where the opportunity lives ───────────

function rankRow(rank) {
  const maxTam = Math.max(...rank.map(r => r.tam), 1);
  return rank.map(r => {
    const pct = Math.max((r.tam / maxTam) * 100, 4);
    const tier = scoreTier(r.avg);
    return `<div class="exec-rank-row">
      <span class="exec-rank-name" title="${escapeHTML(r.name)}">${escapeHTML(r.name)}</span>
      <div class="exec-rank-bar-wrap">
        <div class="exec-rank-bar" style="width:${pct}%;background:${tier.color}"></div>
      </div>
      <span class="exec-rank-tam">${fmt(r.tam)}</span>
      <span class="exec-rank-count">${fmtNum(r.count)} co</span>
    </div>`;
  }).join('');
}

function renderOpportunityRow(x) {
  return `
    <section class="exec-two-col">
      <div class="glass-panel exec-panel">
        <div class="exec-panel-head">
          <h3 class="exec-panel-title">${svgIcon('layers')} Top Sectors by TAM</h3>
          <a class="exec-panel-drill" href="#/">See all</a>
        </div>
        <div class="exec-rank-list">${rankRow(x.sectorRank)}</div>
      </div>
      <div class="glass-panel exec-panel">
        <div class="exec-panel-head">
          <h3 class="exec-panel-title">${svgIcon('map')} Top States by TAM</h3>
          <a class="exec-panel-drill" href="#/">See all</a>
        </div>
        <div class="exec-rank-list">${rankRow(x.stateRank)}</div>
      </div>
    </section>`;
}

// ─── Row 3: What changed this week ────────────────

function renderChangedRow(cache) {
  const up   = topMovers('up', 5);
  const down = topMovers('down', 5);
  const recentSignals = collectRecentSignals(cache, 6);

  const moversHtml = (list, dir) => {
    if (!list.length) return `<p class="exec-empty">No score changes ${dir === 'up' ? 'up' : 'down'} since last snapshot.</p>`;
    return list.map(m => {
      const rec = cache.getAll().find(r => r._dedupeKey === m.key);
      if (!rec) return '';
      const arrow = dir === 'up' ? '▲' : '▼';
      const cls = dir === 'up' ? 'exec-mover-up' : 'exec-mover-down';
      return `<a class="exec-mover" href="#/company/${encodeURIComponent(m.key)}">
        <span class="exec-mover-arrow ${cls}">${arrow} ${Math.abs(m.delta)}</span>
        <span class="exec-mover-name">${escapeHTML(rec.companyName)}</span>
        <span class="exec-mover-score">${m.current}</span>
      </a>`;
    }).join('');
  };

  return `
    <section class="exec-two-col">
      <div class="glass-panel exec-panel">
        <div class="exec-panel-head">
          <h3 class="exec-panel-title">${svgIcon('zap')} Fresh Signals</h3>
          <a class="exec-panel-drill" href="#/signals">Feed →</a>
        </div>
        <div class="exec-signals-list">
          ${recentSignals.length === 0
            ? '<p class="exec-empty">No signals detected in the current dataset.</p>'
            : recentSignals.map(s => `<a class="exec-signal" href="#/company/${encodeURIComponent(s.key)}">
                <span class="exec-signal-type" style="background:${s.color}22;color:${s.color}">${escapeHTML(s.type)}</span>
                <span class="exec-signal-body">
                  <span class="exec-signal-company">${escapeHTML(s.company)}</span>
                  <span class="exec-signal-text">${escapeHTML(s.text)}</span>
                </span>
              </a>`).join('')}
        </div>
      </div>

      <div class="glass-panel exec-panel">
        <div class="exec-panel-head">
          <h3 class="exec-panel-title">${svgIcon('trendUp')} Score Movers</h3>
          <span class="exec-panel-drill exec-drill-muted">Since last data load</span>
        </div>
        <div class="exec-movers">
          <div class="exec-movers-col">
            <div class="exec-movers-title exec-mover-up">▲ Up</div>
            ${moversHtml(up, 'up')}
          </div>
          <div class="exec-movers-col">
            <div class="exec-movers-title exec-mover-down">▼ Down</div>
            ${moversHtml(down, 'down')}
          </div>
        </div>
      </div>
    </section>`;
}

const SIGNAL_META = {
  buying:     { label: 'Buying',     color: '#10B981' },
  gap:        { label: 'Gap',        color: '#3B82F6' },
  risk:       { label: 'Risk',       color: '#EF4444' },
  initiative: { label: 'Initiative', color: '#F59E0B' },
};

function collectRecentSignals(cache, limit) {
  const out = [];
  for (const rec of cache.getAll()) {
    const types = deriveSignalTypes(rec);
    if (types.size === 0) continue;
    for (const t of types) {
      const meta = SIGNAL_META[t];
      let text = '';
      if (t === 'buying')    text = `Estimated ₹${rec.buyingPotential} Cr/yr wallet`;
      if (t === 'gap')       text = 'Modernization opportunity — low maturity';
      if (t === 'risk')      text = 'Cyber uplift opportunity';
      if (t === 'initiative')text = 'Digital initiatives in progress';
      out.push({
        key: rec._dedupeKey,
        company: rec.companyName,
        type: meta.label,
        color: meta.color,
        text,
      });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

// ─── Row 4: Product coverage ──────────────────────

function renderProductRow(cache) {
  const summary = generateStrategySummary(cache.getAll());
  const rank = summary.productRanking.slice(0, 8);
  if (rank.length === 0) return '';

  const maxCount = rank[0].count || 1;

  return `
    <section class="glass-panel exec-panel">
      <div class="exec-panel-head">
        <h3 class="exec-panel-title">${svgIcon('star')} ESDS Product Coverage</h3>
        <span class="exec-panel-drill exec-drill-muted">${summary.companiesWithRecos} addressable · ${summary.coveragePercent}% coverage · ₹${Math.round(summary.totalAddressable)} Cr TAM</span>
      </div>
      <div class="exec-product-grid">
        ${rank.map(r => {
          const pct = Math.round((r.count / maxCount) * 100);
          const color = r.product.color || '#6366F1';
          return `<div class="exec-product-row">
            <div class="exec-product-dot" style="background:${color}"></div>
            <div class="exec-product-name">${escapeHTML(r.product.name)}</div>
            <div class="exec-product-bar-wrap">
              <div class="exec-product-bar" style="width:${pct}%;background:${color}"></div>
            </div>
            <div class="exec-product-count">${r.count} fit</div>
            <div class="exec-product-score">Avg ${r.avgScore}</div>
          </div>`;
        }).join('')}
      </div>
    </section>`;
}

// ─── Row 5: Data health ───────────────────────────

function renderHealthRow(cache, x) {
  const all = cache.getAll();
  const withSources = all.filter(r => r._mergedFrom && r._mergedFrom.length > 0).length;
  const sourceDiversity = all.length ? (withSources / all.length) * 100 : 0;

  return `
    <section class="exec-two-col">
      ${miniHealthTile('Completeness',   fmtPct(x.avgConfidence),  x.avgConfidence,  'Fields present per record on average')}
      ${miniHealthTile('Multi-source',   fmtPct(sourceDiversity),  sourceDiversity,  `${withSources} records verified against 2+ sources`)}
      ${miniHealthTile('Engagement',     fmtPct(x.total ? (x.engagedCount / x.total) * 100 : 0), x.total ? (x.engagedCount / x.total) * 100 : 0, `${x.engagedCount} accounts moved past "New"`)}
    </section>`;
}

function miniHealthTile(label, valueText, pct, hint) {
  const bar = Math.max(0, Math.min(100, pct));
  const barColor = bar >= 70 ? '#10B981' : bar >= 40 ? '#F59E0B' : '#EF4444';
  return `<div class="glass-panel exec-health-tile">
    <div class="exec-health-head">
      <span class="exec-health-label">${escapeHTML(label)}</span>
      <span class="exec-health-value">${escapeHTML(valueText)}</span>
    </div>
    <div class="exec-health-bar-wrap"><div class="exec-health-bar" style="width:${bar}%;background:${barColor}"></div></div>
    <div class="exec-health-hint">${escapeHTML(hint)}</div>
  </div>`;
}

// ─── Mount ────────────────────────────────────────

export async function mountExecutive(container) {
  const cache = dataEngine.cache;
  const user = identity.current();

  if (!cache) {
    container.innerHTML = `<div class="page-container"><section class="glass-panel"><p style="padding:var(--sp-6);text-align:center;color:var(--text-muted)">Waiting for data engine…</p></section></div>`;
    const off = bus.on('data:ready', () => {
      off();
      mountExecutive(container);
    });
    return () => off();
  }

  const x = computeExec(cache);

  container.innerHTML = `
    <div class="page-container exec-page">
      <header class="page-header glass-panel">
        <div class="page-header-left">
          <span class="eyebrow">Executive · Read-only</span>
          <h1 class="page-title">${escapeHTML(user?.name?.split(' ')[0] || 'Executive')}'s Command Deck</h1>
          <p class="page-sub">15-second read of pipeline coverage, whitespace, and signals across the BFSI book.</p>
        </div>
        <div class="page-header-right">
          <button class="btn btn-ghost" id="exec-export">${svgIcon('download')} Export</button>
        </div>
      </header>

      ${renderKPIs(x)}
      ${renderOpportunityRow(x)}
      ${renderChangedRow(cache)}
      ${renderProductRow(cache)}
      ${renderHealthRow(cache, x)}
    </div>`;

  const cleanup = new CleanupRegistry();
  cleanup.addListener(qs('#exec-export', container), 'click', () => bus.emit('export:open'));

  // Re-render on identity swap
  cleanup.add(bus.on('identity:change', () => mountExecutive(container)));
  cleanup.add(bus.on('territory:change', () => {
    // Cheap: coverage tile only. Full re-render for simplicity.
    mountExecutive(container);
  }));

  return () => cleanup.dispose();
}
