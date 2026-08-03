/**
 * compare.js — Company comparison module.
 *
 * Allows selecting up to 3 companies and renders:
 *   - ECharts radar chart (6 dimensions)
 *   - Side-by-side feature comparison table
 *   - Strength / Weakness analysis per company
 *   - Gap analysis across all selected companies
 *   - AI recommendation panel per company
 *   - Top 10 companies to target
 *   - Top Opportunities / Quick Wins / High ROI
 *
 * Opens as a full-screen modal overlay.
 */

import { bus }                from '../utils/eventBus.js';
import { qs, h }             from '../utils/dom.js';
import { Icon }               from '../components/icons.js';
import { loadECharts }        from '../charts/echartsLoader.js';
import { getChartTheme }      from '../charts/chartTheme.js';
import { recommendForCompany, generateTopProspects } from '../recommendations/engine.js';
import { trapFocus, announce } from '../utils/a11y.js';
import { CleanupRegistry }    from '../utils/perf.js';

// ─── State ────────────────────────────────────────

let _cache    = null;
let _selected = [];        // up to 3 company records
let _echart   = null;      // radar echarts instance
let ec        = null;      // echarts namespace
let _cleanup  = null;      // per-open CleanupRegistry
let _releaseFocus = null;  // focus trap teardown

const COLORS = ['#6366F1', '#22D3EE', '#10B981'];
const MAX    = 3;

// ─── Maturity Helpers ─────────────────────────────

function maturityScore(val) {
  if (!val) return 0;
  const v = val.toLowerCase().trim();
  if (/high/i.test(v))   return 90;
  if (/med/i.test(v))    return 55;
  if (/low/i.test(v))    return 25;
  return 0;
}

function maturityLabel(score) {
  if (score >= 70) return 'High';
  if (score >= 40) return 'Medium';
  if (score > 0)   return 'Low';
  return 'N/A';
}

function revenueScore(rev, maxRev) {
  if (!rev || !maxRev) return 0;
  return Math.min(Math.round((rev / maxRev) * 100), 100);
}

function itSpendScore(it, maxIt) {
  if (!it || !maxIt) return 0;
  return Math.min(Math.round((it / maxIt) * 100), 100);
}

function iconHtml(name) {
  const el = Icon(name);
  const tmp = document.createElement('div');
  tmp.appendChild(el);
  return tmp.innerHTML;
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

function fmt(n) {
  if (n == null) return '—';
  if (n >= 100000) return '₹' + (n / 100000).toFixed(1) + 'L Cr';
  if (n >= 1000) return '₹' + (n / 1000).toFixed(1) + 'K Cr';
  return '₹' + n.toFixed(0) + ' Cr';
}

// ─── Dimension Extraction ─────────────────────────

function getDimensions(rec, maxRev, maxIt) {
  return {
    'Cloud Maturity':    maturityScore(rec.cloudMaturity),
    'AI Readiness':      maturityScore(rec.aiReadiness),
    'Cyber Maturity':    maturityScore(rec.cyberMaturity),
    'Digital Maturity':  maturityScore(rec.digitalMaturity),
    'Revenue Scale':     revenueScore(rec.revenue, maxRev),
    'IT Investment':     itSpendScore(rec.itSpend, maxIt),
  };
}

// ─── Strength / Weakness ──────────────────────────

function analyzeStrengthWeakness(dims) {
  const strengths = [];
  const weaknesses = [];
  for (const [k, v] of Object.entries(dims)) {
    if (v >= 70) strengths.push(k);
    else if (v <= 35 && v > 0) weaknesses.push(k);
    else if (v === 0) weaknesses.push(k + ' (No Data)');
  }
  return { strengths, weaknesses };
}

// ─── Gap Analysis ─────────────────────────────────

function gapAnalysis(companies) {
  const dimNames = Object.keys(getDimensions(companies[0], 1, 1));
  const gaps = [];

  for (const dim of dimNames) {
    const scores = companies.map(c => {
      const maxRev = Math.max(...companies.map(x => x.revenue || 0), 1);
      const maxIt  = Math.max(...companies.map(x => x.itSpend || 0), 1);
      return getDimensions(c, maxRev, maxIt)[dim];
    });
    const max = Math.max(...scores);
    const min = Math.min(...scores);
    const gap = max - min;
    if (gap > 15) {
      const leader = companies[scores.indexOf(max)].companyName;
      const laggard = companies[scores.indexOf(min)].companyName;
      gaps.push({ dimension: dim, gap, leader, laggard, max, min });
    }
  }

  gaps.sort((a, b) => b.gap - a.gap);
  return gaps;
}

// ─── Company Search Autocomplete ──────────────────

function renderSearchBox(index) {
  const wrap = h('div', { class: 'cmp-search-wrap', 'data-slot': index });

  const selected = _selected[index];
  if (selected) {
    const chip = h('div', { class: 'cmp-selected-chip', style: `border-color:${COLORS[index]}40` }, [
      h('div', { class: 'cmp-chip-avatar', style: `background:${COLORS[index]}20;color:${COLORS[index]}` },
        (selected.companyName || 'CO').slice(0, 2).toUpperCase()
      ),
      h('div', { class: 'cmp-chip-info' }, [
        h('span', { class: 'cmp-chip-name' }, selected.companyName),
        h('span', { class: 'cmp-chip-meta' }, [selected.category, selected.state].filter(Boolean).join(' · ')),
      ]),
      h('button', {
        class: 'cmp-chip-remove',
        'aria-label': 'Remove',
        html: '✕',
        onclick: () => { _selected[index] = null; refreshModal(); },
      }),
    ]);
    wrap.appendChild(chip);
    return wrap;
  }

  const input = h('input', {
    type: 'text',
    class: 'cmp-search-input',
    placeholder: `Search Company ${index + 1}…`,
    autocomplete: 'off',
  });

  const sugBox = h('div', { class: 'cmp-suggestions' });
  let timer = null;

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const q = input.value.trim().toLowerCase();
      if (q.length < 2 || !_cache) { sugBox.classList.remove('open'); return; }

      const matches = [];
      const selectedKeys = new Set(_selected.filter(Boolean).map(r => r._dedupeKey));

      for (const r of _cache.getAll()) {
        if (matches.length >= 8) break;
        if (selectedKeys.has(r._dedupeKey)) continue;
        const name = (r.companyName || '').toLowerCase();
        if (name.includes(q)) {
          const idx = name.indexOf(q);
          matches.push({ rec: r, idx, len: q.length });
        }
      }

      if (!matches.length) { sugBox.classList.remove('open'); return; }

      sugBox.innerHTML = matches.map((m, i) => {
        const n = m.rec.companyName;
        const before = esc(n.slice(0, m.idx));
        const match  = esc(n.slice(m.idx, m.idx + m.len));
        const after  = esc(n.slice(m.idx + m.len));
        return `<div class="cmp-sug" data-idx="${m.rec._idx}">
          <span class="cmp-sug-name">${before}<mark>${match}</mark>${after}</span>
          <span class="cmp-sug-cat">${esc(m.rec.category || '')}</span>
        </div>`;
      }).join('');

      sugBox.classList.add('open');

      sugBox.querySelectorAll('.cmp-sug').forEach(el => {
        el.addEventListener('click', () => {
          const rec = _cache.getByIndex(parseInt(el.dataset.idx, 10));
          if (rec) {
            _selected[index] = rec;
            refreshModal();
          }
        });
      });
    }, 150);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') sugBox.classList.remove('open');
  });

  wrap.appendChild(input);
  wrap.appendChild(sugBox);
  return wrap;
}

// ─── Radar Chart ──────────────────────────────────

async function renderRadar(container) {
  const companies = _selected.filter(Boolean);
  if (companies.length === 0) {
    container.innerHTML = '<div class="cmp-empty-chart">Select companies to see radar comparison</div>';
    return;
  }

  if (!ec) {
    try { ec = await loadECharts(); } catch { container.innerHTML = '<div class="cmp-empty-chart">Chart library unavailable</div>'; return; }
  }

  container.innerHTML = '';
  const mount = h('div', { style: 'width:100%;height:380px' });
  container.appendChild(mount);

  if (_echart) { try { _echart.dispose(); } catch {} }
  _echart = ec.init(mount, null, { renderer: 'canvas' });

  const t = getChartTheme();
  const maxRev = Math.max(...companies.map(c => c.revenue || 0), 1);
  const maxIt  = Math.max(...companies.map(c => c.itSpend || 0), 1);
  const dimNames = ['Cloud Maturity', 'AI Readiness', 'Cyber Maturity', 'Digital Maturity', 'Revenue Scale', 'IT Investment'];

  const indicator = dimNames.map(name => ({ name, max: 100 }));

  const seriesData = companies.map((c, i) => {
    const dims = getDimensions(c, maxRev, maxIt);
    return {
      value: dimNames.map(d => dims[d]),
      name: c.companyName,
      lineStyle: { width: 2, color: COLORS[i] },
      areaStyle: { color: COLORS[i] + '25' },
      itemStyle: { color: COLORS[i] },
      symbol: 'circle',
      symbolSize: 6,
    };
  });

  _echart.setOption({
    tooltip: {
      ...t.tooltip(),
      trigger: 'item',
    },
    legend: {
      ...t.legend(),
      bottom: 0,
      data: companies.map(c => c.companyName),
    },
    radar: {
      indicator,
      center: ['50%', '48%'],
      radius: '65%',
      shape: 'polygon',
      splitNumber: 4,
      axisName: { color: t.textMuted, fontSize: 11, fontFamily: "'DM Sans',sans-serif" },
      splitLine: { lineStyle: { color: t.splitLine } },
      splitArea: { areaStyle: { color: ['transparent', t.darkMode ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)'] } },
      axisLine: { lineStyle: { color: t.border } },
    },
    series: [{
      type: 'radar',
      data: seriesData,
      animationDuration: 800,
      animationEasing: 'cubicOut',
    }],
  }, true);
}

// ─── Feature Comparison Table ─────────────────────

function renderFeatureTable(companies) {
  const features = [
    { label: 'Category',         key: 'category' },
    { label: 'Sub Sector',       key: 'subSector' },
    { label: 'State',            key: 'state' },
    { label: 'Region',           key: 'region' },
    { label: 'City',             key: 'hqCity' },
    { label: 'Revenue',          key: 'revenue',       fmt: fmt },
    { label: 'Market Cap',       key: 'marketCap',     fmt: fmt },
    { label: 'Employees',        key: 'employeeCount', fmt: (v) => v ? v.toLocaleString() : '—' },
    { label: 'IT Spend',         key: 'itSpend',       fmt: fmt },
    { label: 'Cloud Spend',      key: 'cloudSpend',    fmt: fmt },
    { label: 'CEO / MD',         key: 'ceo' },
    { label: 'CTO',              key: 'cto' },
    { label: 'CIO',              key: 'cio' },
    { label: 'Cloud Maturity',   key: 'cloudMaturity' },
    { label: 'AI Readiness',     key: 'aiReadiness' },
    { label: 'Cyber Maturity',   key: 'cyberMaturity' },
    { label: 'Digital Maturity', key: 'digitalMaturity' },
    { label: 'Core Platform',    key: 'corePlatform' },
    { label: 'Ownership',        key: 'ownership' },
    { label: 'Listed Status',    key: 'listedStatus' },
    { label: 'Year Founded',     key: 'yearFounded' },
    { label: 'Website',          key: 'website' },
  ];

  const headerCells = companies.map((c, i) =>
    `<th style="color:${COLORS[i]}">${esc(c.companyName)}</th>`
  ).join('');

  const rows = features.map(f => {
    const cells = companies.map(c => {
      const raw = c[f.key];
      const display = f.fmt ? f.fmt(raw) : (raw || '—');
      return `<td>${esc(String(display))}</td>`;
    }).join('');
    return `<tr><td class="cmp-feat-label">${f.label}</td>${cells}</tr>`;
  }).join('');

  return `<div class="cmp-table-wrap"><table class="cmp-table">
    <thead><tr><th>Feature</th>${headerCells}</tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

// ─── Strength / Weakness Cards ────────────────────

function renderStrengthWeakness(companies) {
  const maxRev = Math.max(...companies.map(c => c.revenue || 0), 1);
  const maxIt  = Math.max(...companies.map(c => c.itSpend || 0), 1);

  return companies.map((c, i) => {
    const dims = getDimensions(c, maxRev, maxIt);
    const { strengths, weaknesses } = analyzeStrengthWeakness(dims);

    return `<div class="cmp-sw-card" style="border-top:3px solid ${COLORS[i]}">
      <h4 class="cmp-sw-name" style="color:${COLORS[i]}">${esc(c.companyName)}</h4>
      <div class="cmp-sw-section">
        <div class="cmp-sw-label">${iconHtml('trendUp')} Strengths</div>
        ${strengths.length ? strengths.map(s => `<span class="cmp-sw-tag cmp-sw-strong">${s}</span>`).join('') : '<span class="cmp-sw-none">No strong dimensions identified</span>'}
      </div>
      <div class="cmp-sw-section">
        <div class="cmp-sw-label">${iconHtml('trendDown')} Weaknesses</div>
        ${weaknesses.length ? weaknesses.map(w => `<span class="cmp-sw-tag cmp-sw-weak">${w}</span>`).join('') : '<span class="cmp-sw-none">No critical weaknesses</span>'}
      </div>
    </div>`;
  }).join('');
}

// ─── Gap Analysis ─────────────────────────────────

function renderGapAnalysis(companies) {
  const gaps = gapAnalysis(companies);
  if (gaps.length === 0) return '<p class="cmp-gap-empty">No significant gaps detected between selected companies.</p>';

  return gaps.map(g => `
    <div class="cmp-gap-row">
      <div class="cmp-gap-dim">${g.dimension}</div>
      <div class="cmp-gap-bar-wrap">
        <div class="cmp-gap-bar" style="width:${g.gap}%;background:linear-gradient(90deg,#EF4444,#F59E0B)"></div>
      </div>
      <div class="cmp-gap-info">
        <span class="cmp-gap-score">${g.gap}pt gap</span>
        <span class="cmp-gap-detail">${esc(g.leader)} leads (${g.max}) vs ${esc(g.laggard)} (${g.min})</span>
      </div>
    </div>
  `).join('');
}

// ─── AI Recommendation Panel ──────────────────────

function renderRecoPanel(companies) {
  return companies.map((c, i) => {
    const recos = recommendForCompany(c).slice(0, 5);
    if (recos.length === 0) return `<div class="cmp-reco-card" style="border-top:3px solid ${COLORS[i]}">
      <h4 style="color:${COLORS[i]}">${esc(c.companyName)}</h4>
      <p class="cmp-reco-empty">No product recommendations for this company.</p>
    </div>`;

    const items = recos.map(r => `
      <div class="cmp-reco-item">
        <div class="cmp-reco-dot" style="background:${r.product.color || COLORS[i]}"></div>
        <div class="cmp-reco-info">
          <span class="cmp-reco-name">${r.product.name}</span>
          <span class="cmp-reco-reason">${esc(r.reasons[0] || '')}</span>
        </div>
        <span class="cmp-reco-score">${r.score}</span>
      </div>
    `).join('');

    return `<div class="cmp-reco-card" style="border-top:3px solid ${COLORS[i]}">
      <h4 style="color:${COLORS[i]}">${esc(c.companyName)}</h4>
      ${items}
    </div>`;
  }).join('');
}

// ─── Top 10 / Opportunities / Quick Wins ──────────

function renderTargetingPanel(records) {
  const prospects = generateTopProspects(records, 10);

  // Quick Wins: low complexity, high score
  const quickWins = [];
  const highROI   = [];
  for (const p of prospects) {
    for (const r of p.recommendations) {
      if (r.complexity === 'Low' && r.score >= 40 && quickWins.length < 5) {
        quickWins.push({ company: p.company.companyName, product: r.product.name, score: r.score, timeline: r.timeline });
      }
      if (r.score >= 60 && highROI.length < 5) {
        highROI.push({ company: p.company.companyName, product: r.product.name, score: r.score, roi: r.expectedROI });
      }
    }
  }

  const top10Html = prospects.map((p, i) => `
    <div class="cmp-target-row">
      <span class="cmp-target-rank">${i + 1}</span>
      <div class="cmp-target-info">
        <span class="cmp-target-name">${esc(p.company.companyName)}</span>
        <span class="cmp-target-meta">${esc(p.company.category || '')} · ${p.recoCount} products · Score ${p.avgScore}</span>
      </div>
      <span class="cmp-target-score" style="color:${p.avgScore >= 60 ? '#10B981' : p.avgScore >= 40 ? '#F59E0B' : '#EF4444'}">${p.avgScore}</span>
    </div>
  `).join('');

  const qwHtml = quickWins.length ? quickWins.map(q => `
    <div class="cmp-qw-row">
      <span class="cmp-qw-badge">${iconHtml('zap')}</span>
      <div class="cmp-qw-info">
        <span class="cmp-qw-name">${esc(q.company)}</span>
        <span class="cmp-qw-product">${esc(q.product)} · ${q.timeline}</span>
      </div>
      <span class="cmp-qw-score">${q.score}</span>
    </div>
  `).join('') : '<p class="cmp-gap-empty">No quick wins identified in current dataset.</p>';

  const roiHtml = highROI.length ? highROI.map(r => `
    <div class="cmp-qw-row">
      <span class="cmp-qw-badge cmp-roi-badge">${iconHtml('trendUp')}</span>
      <div class="cmp-qw-info">
        <span class="cmp-qw-name">${esc(r.company)}</span>
        <span class="cmp-qw-product">${esc(r.product)}</span>
      </div>
      <span class="cmp-qw-score">${r.score}</span>
    </div>
  `).join('') : '<p class="cmp-gap-empty">No high-ROI accounts identified.</p>';

  return `
    <div class="cmp-targeting-grid">
      <div class="cmp-targeting-col">
        <h4 class="cmp-targeting-title">${iconHtml('target')} Top 10 Companies to Target</h4>
        ${top10Html}
      </div>
      <div class="cmp-targeting-col">
        <h4 class="cmp-targeting-title">${iconHtml('zap')} Quick Wins</h4>
        ${qwHtml}
        <h4 class="cmp-targeting-title" style="margin-top:var(--sp-4)">${iconHtml('trendUp')} High ROI Accounts</h4>
        ${roiHtml}
      </div>
    </div>`;
}

// ─── Modal Renderer ───────────────────────────────

function refreshModal() {
  const body = qs('#cmp-modal-body');
  if (!body) return;

  const companies = _selected.filter(Boolean);

  // Search slots
  const searchArea = qs('#cmp-search-area');
  if (searchArea) {
    searchArea.innerHTML = '';
    for (let i = 0; i < MAX; i++) {
      searchArea.appendChild(renderSearchBox(i));
    }
  }

  if (companies.length === 0) {
    body.innerHTML = `<div class="cmp-placeholder">
      <div class="cmp-placeholder-icon">${iconHtml('layers')}</div>
      <h3>Select Companies to Compare</h3>
      <p>Choose up to 3 companies from the search boxes above to see radar charts, feature comparison, gap analysis, and AI-powered recommendations.</p>
    </div>`;
    return;
  }

  body.innerHTML = `
    <div class="cmp-section">
      <h3 class="cmp-section-title">${iconHtml('target')} Radar Comparison</h3>
      <div id="cmp-radar-mount"></div>
    </div>

    <div class="cmp-section">
      <h3 class="cmp-section-title">${iconHtml('chart')} Feature Comparison</h3>
      ${renderFeatureTable(companies)}
    </div>

    <div class="cmp-section">
      <h3 class="cmp-section-title">${iconHtml('trendUp')} Strength & Weakness Analysis</h3>
      <div class="cmp-sw-grid">${renderStrengthWeakness(companies)}</div>
    </div>

    ${companies.length >= 2 ? `<div class="cmp-section">
      <h3 class="cmp-section-title">${iconHtml('alertCircle')} Gap Analysis</h3>
      <div class="cmp-gap-list">${renderGapAnalysis(companies)}</div>
    </div>` : ''}

    <div class="cmp-section">
      <h3 class="cmp-section-title">${iconHtml('star')} AI Recommendations</h3>
      <div class="cmp-reco-grid">${renderRecoPanel(companies)}</div>
    </div>

    <div class="cmp-section">
      <h3 class="cmp-section-title">${iconHtml('building')} Targeting Intelligence</h3>
      ${renderTargetingPanel(_cache.getAll())}
    </div>
  `;

  renderRadar(qs('#cmp-radar-mount'));
}

function openCompareModal() {
  let overlay = qs('#cmp-overlay');
  if (overlay) overlay.remove();

  overlay = h('div', {
    class: 'cmp-overlay',
    id: 'cmp-overlay',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'cmp-modal-title',
  });

  const modal = h('div', { class: 'cmp-modal glass-panel' });

  const header = h('div', { class: 'cmp-modal-header' }, [
    h('div', { class: 'cmp-modal-title-wrap' }, [
      h('h2', { class: 'cmp-modal-title', id: 'cmp-modal-title' }, 'Company Comparison'),
      h('p', { class: 'cmp-modal-sub' }, 'Select up to 3 companies for side-by-side intelligence analysis'),
    ]),
    h('button', {
      class: 'icon-btn cmp-close',
      'aria-label': 'Close',
      html: '✕',
      onclick: closeCompareModal,
    }),
  ]);

  const searchArea = h('div', { class: 'cmp-search-area', id: 'cmp-search-area' });
  for (let i = 0; i < MAX; i++) searchArea.appendChild(renderSearchBox(i));

  const body = h('div', { class: 'cmp-modal-body', id: 'cmp-modal-body' });

  modal.appendChild(header);
  modal.appendChild(searchArea);
  modal.appendChild(body);
  overlay.appendChild(modal);
  const triggerEl = document.activeElement;
  document.body.appendChild(overlay);

  requestAnimationFrame(() => overlay.classList.add('open'));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeCompareModal(); });

  _cleanup = new CleanupRegistry();
  _releaseFocus = trapFocus(overlay, { restore: triggerEl });
  announce('Comparison dialog opened. Search up to 3 companies.', 'polite');

  refreshModal();
}

function closeCompareModal() {
  const overlay = qs('#cmp-overlay');
  if (!overlay) return;
  overlay.classList.remove('open');
  if (_echart) { try { _echart.dispose(); } catch {} _echart = null; }
  if (_releaseFocus) { _releaseFocus(); _releaseFocus = null; }
  if (_cleanup) { _cleanup.dispose(); _cleanup = null; }
  setTimeout(() => overlay.remove(), 300);
}

// ─── Public Init ──────────────────────────────────

export function initCompare() {
  bus.on('data:ready', ({ cache }) => { _cache = cache; });

  bus.on('compare:open', () => {
    if (_cache) openCompareModal();
  });

  bus.on('compare:add', (rec) => {
    if (!_cache) return;
    const emptySlot = _selected.findIndex(s => !s);
    if (emptySlot >= 0) {
      _selected[emptySlot] = rec;
    } else if (_selected.length < MAX) {
      _selected.push(rec);
    }
    openCompareModal();
  });
}
