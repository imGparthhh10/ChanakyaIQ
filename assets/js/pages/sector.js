/**
 * sector.js — Sector Deep-Dive pages.
 *
 * URL: #/sector/:key   (:key is the URL-encoded category name)
 *
 * One page per sector. Renders:
 *   - Header with sector name + macro KPIs (companies, TAM, avg score)
 *   - Maturity profile — average cloud/AI/cyber/digital as bars
 *   - Regional distribution (top states in the sector)
 *   - Top 10 companies in sector by opportunity
 *   - Product fit density — which ESDS products fit this sector best
 *
 * Everything is derived from the cache; no separate ingestion needed.
 */

import { bus }                   from '../utils/eventBus.js';
import { qs }                    from '../utils/dom.js';
import { escapeHTML }            from '../utils/sanitize.js';
import { CleanupRegistry }       from '../utils/perf.js';
import { Icon }                  from '../components/icons.js';
import { dataEngine }            from '../data/data.js';
import { opportunityValue, confidenceScore, scoreTier } from '../workspace/scoring.js';
import { deriveSignalTypes }     from '../workspace/signals.js';
import { recommendForCompany }   from '../recommendations/engine.js';
import { navigate }              from '../router.js';

function svgIcon(name) {
  const el = Icon(name);
  const tmp = document.createElement('div');
  tmp.appendChild(el);
  return tmp.innerHTML;
}

function fmt(n) {
  if (n == null) return '—';
  if (n >= 1000) return '₹' + (n / 1000).toFixed(1) + 'K Cr';
  return '₹' + Number(n).toFixed(0) + ' Cr';
}

function maturityAvg(records, field) {
  if (!records.length) return { avg: 0, high: 0, med: 0, low: 0, na: 0 };
  let sum = 0, high = 0, med = 0, low = 0, na = 0;
  for (const r of records) {
    const v = String(r[field] || '').toLowerCase();
    if (/high|advanced/.test(v))    { sum += 90; high++; }
    else if (/med|moderate/.test(v)){ sum += 55; med++; }
    else if (/low|basic/.test(v))   { sum += 25; low++; }
    else                             { na++; }
  }
  const rated = records.length - na;
  return { avg: rated ? Math.round(sum / rated) : 0, high, med, low, na };
}

// ─── Compute ──────────────────────────────────────

function computeSector(records) {
  let tam = 0, sumScore = 0, sumConf = 0;
  let signals = { buying: 0, gap: 0, risk: 0, initiative: 0 };
  const byState = {};
  const byRegion = {};
  const products = {};

  for (const r of records) {
    tam += (r.buyingPotential || 0);
    sumScore += opportunityValue(r);
    sumConf  += confidenceScore(r);

    for (const t of deriveSignalTypes(r)) signals[t] = (signals[t] || 0) + 1;

    const st = r.state || 'Unknown';
    if (!byState[st]) byState[st] = { count: 0, tam: 0 };
    byState[st].count++;
    byState[st].tam += (r.buyingPotential || 0);

    const rg = r.region || 'Unknown';
    if (!byRegion[rg]) byRegion[rg] = { count: 0, tam: 0 };
    byRegion[rg].count++;
    byRegion[rg].tam += (r.buyingPotential || 0);

    // Product fit density
    const recos = recommendForCompany(r, 30);
    for (const rc of recos) {
      const p = rc.product;
      if (!products[p.id]) products[p.id] = { product: p, count: 0, sumScore: 0 };
      products[p.id].count++;
      products[p.id].sumScore += rc.score;
    }
  }

  return {
    total: records.length,
    tam,
    avgScore: records.length ? Math.round(sumScore / records.length) : 0,
    avgConfidence: records.length ? Math.round(sumConf / records.length) : 0,
    signals,
    cloudMaturity:   maturityAvg(records, 'cloudMaturity'),
    aiReadiness:     maturityAvg(records, 'aiReadiness'),
    cyberMaturity:   maturityAvg(records, 'cyberMaturity'),
    digitalMaturity: maturityAvg(records, 'digitalMaturity'),
    stateRank:  Object.entries(byState).sort((a, b) => b[1].tam - a[1].tam).slice(0, 10),
    regionRank: Object.entries(byRegion).sort((a, b) => b[1].tam - a[1].tam),
    productRank: Object.values(products).map(p => ({ ...p, avg: Math.round(p.sumScore / p.count) })).sort((a, b) => b.count - a.count).slice(0, 8),
  };
}

// ─── Render ───────────────────────────────────────

function maturityCard(label, m) {
  const bars = [
    { label: 'High',   count: m.high, color: '#10B981' },
    { label: 'Medium', count: m.med,  color: '#F59E0B' },
    { label: 'Low',    count: m.low,  color: '#EF4444' },
    { label: 'N/A',    count: m.na,   color: '#64748B' },
  ];
  const total = bars.reduce((s, b) => s + b.count, 0) || 1;
  return `<div class="sec-maturity">
    <div class="sec-maturity-head">
      <span class="sec-maturity-label">${escapeHTML(label)}</span>
      <span class="sec-maturity-score">Avg ${m.avg}</span>
    </div>
    <div class="sec-maturity-track">
      ${bars.map(b => b.count === 0 ? '' : `<div class="sec-maturity-seg" style="flex:${b.count / total};background:${b.color}" title="${b.label}: ${b.count}"></div>`).join('')}
    </div>
    <div class="sec-maturity-legend">
      ${bars.filter(b => b.count > 0).map(b => `<span><i style="background:${b.color}"></i>${b.label} ${b.count}</span>`).join('')}
    </div>
  </div>`;
}

function renderTopCompanies(records) {
  const top = records
    .map(r => ({ rec: r, score: opportunityValue(r) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  return `<div class="glass-panel exec-panel">
    <div class="exec-panel-head">
      <h3 class="exec-panel-title">${svgIcon('trendUp')} Top Companies in Sector</h3>
    </div>
    <table class="sec-top-table">
      <thead><tr><th>#</th><th>Company</th><th>Location</th><th class="mt-num">Score</th><th class="mt-num">TAM</th></tr></thead>
      <tbody>
        ${top.map((it, i) => {
          const t = scoreTier(it.score);
          return `<tr>
            <td class="ws-col-rank">${i + 1}</td>
            <td><a class="mt-row-name" href="#/company/${encodeURIComponent(it.rec._dedupeKey)}">${escapeHTML(it.rec.companyName)}</a></td>
            <td class="mt-muted">${escapeHTML([it.rec.hqCity, it.rec.state].filter(Boolean).join(', ') || '—')}</td>
            <td class="mt-num"><span class="mt-score-chip" style="color:${t.color};border-color:${t.color}44">${it.score}</span></td>
            <td class="mt-num">${escapeHTML(fmt(it.rec.buyingPotential))}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>`;
}

function renderSectorProducts(rank) {
  if (!rank.length) return '';
  const maxCount = rank[0].count || 1;
  return `<div class="glass-panel exec-panel">
    <div class="exec-panel-head">
      <h3 class="exec-panel-title">${svgIcon('star')} Product Fit Density</h3>
      <span class="exec-panel-drill exec-drill-muted">Products with the strongest sector-wide fit</span>
    </div>
    <div class="exec-product-grid">
      ${rank.map(r => {
        const pct = Math.round((r.count / maxCount) * 100);
        const color = r.product.color || '#6366F1';
        return `<div class="exec-product-row">
          <div class="exec-product-dot" style="background:${color}"></div>
          <div class="exec-product-name">${escapeHTML(r.product.name)}</div>
          <div class="exec-product-bar-wrap"><div class="exec-product-bar" style="width:${pct}%;background:${color}"></div></div>
          <div class="exec-product-count">${r.count} fit</div>
          <div class="exec-product-score">Avg ${r.avg}</div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

function renderStateRank(rank) {
  if (!rank.length) return '';
  const maxTam = Math.max(...rank.map(r => r[1].tam), 1);
  return `<div class="glass-panel exec-panel">
    <div class="exec-panel-head">
      <h3 class="exec-panel-title">${svgIcon('map')} Top States in Sector</h3>
    </div>
    <div class="exec-rank-list">
      ${rank.map(([name, v]) => {
        const pct = Math.max((v.tam / maxTam) * 100, 4);
        return `<div class="exec-rank-row">
          <span class="exec-rank-name">${escapeHTML(name)}</span>
          <div class="exec-rank-bar-wrap"><div class="exec-rank-bar" style="width:${pct}%;background:#6366F1"></div></div>
          <span class="exec-rank-tam">${fmt(v.tam)}</span>
          <span class="exec-rank-count">${v.count} co</span>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

// ─── Mount ────────────────────────────────────────

export async function mountSector(container, params) {
  const sectorKey = decodeURIComponent(params.key || '');
  const cache = dataEngine.cache;

  if (!cache) {
    container.innerHTML = `<div class="page-container"><section class="glass-panel"><p style="padding:var(--sp-6);text-align:center;color:var(--text-muted)">Waiting for data engine…</p></section></div>`;
    const off = bus.on('data:ready', () => { off(); mountSector(container, params); });
    return () => off();
  }

  const records = cache.getByCategory(sectorKey);
  if (records.length === 0) {
    container.innerHTML = `
      <div class="page-container">
        <section class="glass-panel c360-notfound">
          <div class="c360-nf-icon">🔍</div>
          <h2>No companies in "${escapeHTML(sectorKey)}"</h2>
          <p>Pick a sector from the sidebar's Sectors index.</p>
          <button class="btn btn-primary" onclick="location.hash='#/sectors'">Back to Sectors</button>
        </section>
      </div>`;
    return () => {};
  }

  const s = computeSector(records);
  document.title = `${sectorKey} · Sector Deep-Dive · ESDS BOIP`;

  container.innerHTML = `
    <div class="page-container sec-page">
      <header class="page-header glass-panel">
        <div class="page-header-left">
          <nav class="c360-breadcrumb" aria-label="Breadcrumb">
            <a href="#/">Home</a> <span>/</span>
            <a href="#/sectors">Sectors</a> <span>/</span>
            <span class="c360-crumb-current">${escapeHTML(sectorKey)}</span>
          </nav>
          <h1 class="page-title">${escapeHTML(sectorKey)}</h1>
          <p class="page-sub">Sector-level intelligence across ${s.total.toLocaleString('en-IN')} companies.</p>
        </div>
        <div class="page-header-right mt-summary">
          <div class="mt-summary-tile"><span class="mt-summary-label">Companies</span><span class="mt-summary-value">${s.total}</span></div>
          <div class="mt-summary-tile"><span class="mt-summary-label">Sector TAM</span><span class="mt-summary-value">${fmt(s.tam)}</span></div>
          <div class="mt-summary-tile"><span class="mt-summary-label">Avg score</span><span class="mt-summary-value">${s.avgScore}</span></div>
        </div>
      </header>

      <section class="sec-two-col">
        <div class="glass-panel exec-panel">
          <div class="exec-panel-head">
            <h3 class="exec-panel-title">${svgIcon('target')} Sector Maturity Profile</h3>
          </div>
          <div class="sec-maturity-grid">
            ${maturityCard('Cloud',   s.cloudMaturity)}
            ${maturityCard('AI',      s.aiReadiness)}
            ${maturityCard('Cyber',   s.cyberMaturity)}
            ${maturityCard('Digital', s.digitalMaturity)}
          </div>
        </div>

        <div class="glass-panel exec-panel">
          <div class="exec-panel-head">
            <h3 class="exec-panel-title">${svgIcon('zap')} Signal Density</h3>
            <span class="exec-panel-drill exec-drill-muted">Accounts with each signal type</span>
          </div>
          <div class="sec-signal-grid">
            ${signalTile('Buying', s.signals.buying, s.total, '#10B981')}
            ${signalTile('Modernization gap', s.signals.gap, s.total, '#3B82F6')}
            ${signalTile('Cyber risk', s.signals.risk, s.total, '#EF4444')}
            ${signalTile('Active initiatives', s.signals.initiative, s.total, '#F59E0B')}
          </div>
        </div>
      </section>

      <section class="sec-two-col">
        ${renderStateRank(s.stateRank)}
        ${renderSectorProducts(s.productRank)}
      </section>

      ${renderTopCompanies(records)}
    </div>`;

  const cleanup = new CleanupRegistry();
  return () => { cleanup.dispose(); document.title = 'ESDS BFSI Geo Intelligence Dashboard'; };
}

function signalTile(label, count, total, color) {
  const pct = total ? Math.round((count / total) * 100) : 0;
  return `<div class="sec-signal-tile">
    <div class="sec-signal-count" style="color:${color}">${count}</div>
    <div class="sec-signal-label">${escapeHTML(label)}</div>
    <div class="sec-signal-bar-wrap"><div class="sec-signal-bar" style="width:${pct}%;background:${color}"></div></div>
    <div class="sec-signal-pct">${pct}% of sector</div>
  </div>`;
}
