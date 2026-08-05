/**
 * kpiCards.js — Executive KPI card renderer.
 *
 * Dynamically computes 15 KPI metrics from the data cache,
 * renders animated cards with sparkline trend visuals,
 * color-coded icons, and counter animations.
 */

import { bus }  from '../utils/eventBus.js';
import { qs }   from '../utils/dom.js';
import { Icon } from './icons.js';
import { dataEngine } from '../data/data.js';
import { opportunityValue } from '../workspace/scoring.js';

// ─── Metric Computation ───────────────────

function computeExecutiveKPIs(cache, records) {
  const data = records || cache.getAll();
  const n = data.length;
  if (n === 0) return null;

  let totalRevenue = 0, totalMarketCap = 0, totalIT = 0, totalCloud = 0;
  let revCount = 0, mcapCount = 0;
  let totalNetProfit = 0, netProfitCount = 0;
  let aiScoreSum = 0, aiCount = 0;
  let cyberScoreSum = 0, cyberCount = 0;
  let highestRevRec = null, highestRev = 0;
  let qualifiedCount = 0, strategicCount = 0;

  const maturityScore = (level) => {
    if (!level) return 0;
    const l = level.toLowerCase();
    if (l === 'high' || l === 'advanced')   return 3;
    if (l === 'medium' || l === 'moderate') return 2;
    if (l === 'low' || l === 'basic')       return 1;
    return 0;
  };

  const stateOppMap = {};
  const regionOppMap = {};
  const sectorOppMap = {};
  const revenueByCategory = {};

  for (const r of data) {
    if (r.revenue != null)    { totalRevenue += r.revenue; revCount++; if (r.revenue > highestRev) { highestRev = r.revenue; highestRevRec = r; } }
    if (r.marketCap != null)  { totalMarketCap += r.marketCap; mcapCount++; }
    if (r.itSpend != null)    totalIT += r.itSpend;
    if (r.cloudSpend != null) totalCloud += r.cloudSpend;
    if (r.netProfit != null)  { totalNetProfit += r.netProfit; netProfitCount++; }
    if (r.isQualified)        qualifiedCount++;
    if (r.opportunityTier === 'Strategic') strategicCount++;

    const ai = maturityScore(r.aiReadiness);
    if (ai > 0) { aiScoreSum += ai; aiCount++; }

    const cy = maturityScore(r.cyberMaturity);
    if (cy > 0) { cyberScoreSum += cy; cyberCount++; }

    // Opportunity scoring per dimension — canonical formula (scoring.js),
    // shared with Company 360, sub-sector cards, and score-movers.
    const opp = opportunityValue(r);

    if (r.state) {
      if (!stateOppMap[r.state]) stateOppMap[r.state] = { total: 0, count: 0 };
      stateOppMap[r.state].total += opp;
      stateOppMap[r.state].count++;
    }
    if (r.region) {
      if (!regionOppMap[r.region]) regionOppMap[r.region] = { total: 0, count: 0 };
      regionOppMap[r.region].total += opp;
      regionOppMap[r.region].count++;
    }
    if (r.category) {
      if (!sectorOppMap[r.category]) sectorOppMap[r.category] = { total: 0, count: 0 };
      sectorOppMap[r.category].total += opp;
      sectorOppMap[r.category].count++;

      if (!revenueByCategory[r.category]) revenueByCategory[r.category] = 0;
      revenueByCategory[r.category] += r.revenue || 0;
    }
  }

  const avgNetProfit = netProfitCount > 0 ? (totalNetProfit / netProfitCount) : 0;
  const avgAI = aiCount > 0 ? (aiScoreSum / aiCount) : 0;
  const avgCyber = cyberCount > 0 ? (cyberScoreSum / cyberCount) : 0;

  const avgOpp = data.reduce((s, r) => s + opportunityValue(r), 0) / n;

  const topState = getTopEntry(stateOppMap);
  const topRegion = getTopEntry(regionOppMap);
  const topSector = getTopEntry(sectorOppMap);

  // Highest ROI: sector with best revenue-to-count ratio
  const sectorROI = Object.entries(sectorOppMap).map(([name, { total, count }]) => ({
    name, score: (total / count) * (revenueByCategory[name] || 0) / Math.max(count, 1),
  })).sort((a, b) => b.score - a.score);

  // Sparkline data: revenue distribution across top categories (for trend visual)
  const catRevSorted = Object.entries(revenueByCategory)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([, v]) => v);

  // State company count distribution for sparkline
  const stateCounts = cache.stateCounts ? cache.stateCounts() : {};
  const stateCountValues = Object.values(stateCounts).sort((a, b) => b - a).slice(0, 10);

  return {
    totalCompanies: n,
    totalRevenue,
    totalMarketCap,
    totalIT,
    totalCloud,
    totalNetProfit,
    netProfitCount,
    avgNetProfit,
    avgAIReadiness: avgAI,
    avgAILabel: maturityLabel(avgAI),
    avgCyberScore: avgCyber,
    avgCyberLabel: maturityLabel(avgCyber),
    avgOpportunity: Math.round(avgOpp),
    highestRevCompany: highestRevRec ? highestRevRec.companyName : '—',
    highestRevValue: highestRev,
    topState: topState?.name || '—',
    topStateScore: topState?.avg || 0,
    topRegion: topRegion?.name || '—',
    topRegionScore: topRegion?.avg || 0,
    topSector: topSector?.name || '—',
    topSectorScore: topSector?.avg || 0,
    highestROISector: sectorROI[0]?.name || '—',
    icpQualifiedCount: qualifiedCount,
    strategicAccountCount: strategicCount,
    sparkCatRevenue: catRevSorted,
    sparkStateCounts: stateCountValues,

    // Branch-level metrics — 0 until Banking Master's branch data is loaded
    totalBranches: (dataEngine.branches || []).length,
    totalStates: (() => {
      // Canonicalize common state-name variants so duplicates don't inflate the count
      const ALIAS = {
        'orissa': 'odisha', 'uttaranchal': 'uttarakhand', 'pondicherry': 'puducherry',
        'jammu & kashmir': 'jammu and kashmir', 'j&k': 'jammu and kashmir',
        'nct of delhi': 'delhi', 'new delhi': 'delhi',
        'andaman and nicobar island': 'andaman and nicobar islands',
      };
      const canon = (s) => {
        let k = String(s).toLowerCase().trim().replace(/\s+/g, ' ');
        k = k.replace(/\s*\(ut\)$/, '').trim();   // "Jammu And Kashmir (UT)" → "jammu and kashmir"
        return ALIAS[k] || k;
      };
      const set = new Set();
      for (const b of (dataEngine.branches || [])) if (b.state) set.add(canon(b.state));
      for (const r of (data || [])) if (r && r.state) set.add(canon(r.state));
      return set.size;
    })(),
    citiesCovered: (() => {
      const set = new Set();
      for (const b of (dataEngine.branches || [])) if (b.city) set.add(b.city);
      for (const r of (data || [])) if (r && r.hqCity) set.add(r.hqCity);
      return set.size;
    })(),
    districtCoverage: (() => {
      const set = new Set();
      for (const b of (dataEngine.branches || [])) if (b.district) set.add(b.district);
      return set.size;
    })(),
  };
}

function maturityLabel(avg) {
  if (avg >= 2.5) return 'High';
  if (avg >= 1.5) return 'Medium';
  if (avg > 0)    return 'Low';
  return 'N/A';
}

function getTopEntry(map) {
  let top = null;
  for (const [name, { total, count }] of Object.entries(map)) {
    const avg = total / count;
    // Weight by count to avoid single-company outliers
    const weighted = avg * Math.log2(count + 1);
    if (!top || weighted > top.weighted) {
      top = { name, avg: Math.round(avg), count, weighted };
    }
  }
  return top;
}

// ─── Formatting ───────────────────────────

function fmtCurrency(n) {
  if (n == null || n === 0) return '—';
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(1)}Cr`;
  if (n >= 100000)   return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000)     return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${n.toFixed(0)}`;
}

function fmtNumber(n) {
  if (n == null) return '—';
  return n.toLocaleString('en-IN');
}

// ─── Sparkline SVG ────────────────────────

function sparklineSVG(values, color, width = 80, height = 28) {
  if (!values || values.length < 2) {
    return `<svg class="kpi-sparkline-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"></svg>`;
  }

  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const padding = 2;
  const usableH = height - padding * 2;
  const step = (width - padding * 2) / (values.length - 1);

  const points = values.map((v, i) => {
    const x = padding + i * step;
    const y = padding + usableH - ((v - min) / range) * usableH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const fillPoints = [
    `${padding},${height - padding}`,
    ...points,
    `${padding + (values.length - 1) * step},${height - padding}`,
  ].join(' ');

  return `
    <svg class="kpi-sparkline-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <polygon points="${fillPoints}" fill="${color}" fill-opacity="0.12"/>
      <polyline points="${points.join(' ')}" fill="none" stroke="${color}" stroke-width="1.5"
                stroke-linecap="round" stroke-linejoin="round" class="kpi-spark-line"/>
      <circle cx="${points[points.length-1].split(',')[0]}" cy="${points[points.length-1].split(',')[1]}"
              r="2.5" fill="${color}" class="kpi-spark-dot"/>
    </svg>`;
}

// ─── Card Definitions ─────────────────────

function buildCardDefs(kpis) {
  return [
    {
      id: 'total-companies',
      label: 'Total Companies',
      value: fmtNumber(kpis.totalCompanies),
      rawValue: kpis.totalCompanies,
      sub: 'Unique parent companies',
      icon: 'building',
      color: '#3B82F6',
      gradient: 'linear-gradient(135deg, #1E3A8A, #3B82F6)',
      sparkData: kpis.sparkStateCounts,
    },
    {
      id: 'total-branches',
      label: 'Total Branches',
      value: fmtNumber(kpis.totalBranches),
      rawValue: kpis.totalBranches,
      sub: kpis.totalBranches > 0
        ? `${kpis.totalStates} states · ${kpis.citiesCovered.toLocaleString('en-IN')} cities`
        : 'No branch-level data loaded',
      icon: 'link',
      color: '#EC4899',
      gradient: 'linear-gradient(135deg, #831843, #EC4899)',
    },
    {
      id: 'total-revenue',
      label: 'Total Revenue',
      value: fmtCurrency(kpis.totalRevenue),
      rawValue: kpis.totalRevenue,
      sub: 'Aggregate FY revenue',
      icon: 'dollar',
      color: '#10B981',
      gradient: 'linear-gradient(135deg, #065F46, #10B981)',
      sparkData: kpis.sparkCatRevenue,
    },
    {
      id: 'market-cap',
      label: 'Market Cap',
      value: fmtCurrency(kpis.totalMarketCap),
      rawValue: kpis.totalMarketCap,
      sub: 'Combined market value',
      icon: 'trendUp',
      color: '#8B5CF6',
      gradient: 'linear-gradient(135deg, #4C1D95, #8B5CF6)',
    },
    {
      id: 'it-spend',
      label: 'IT Spend',
      value: fmtCurrency(kpis.totalIT),
      rawValue: kpis.totalIT,
      sub: 'Annual technology budget',
      icon: 'chart',
      color: '#0EA5E9',
      gradient: 'linear-gradient(135deg, #0C4A6E, #0EA5E9)',
    },
    {
      id: 'cloud-spend',
      label: 'Cloud Spend',
      value: fmtCurrency(kpis.totalCloud),
      rawValue: kpis.totalCloud,
      sub: 'Annual cloud investment',
      icon: 'layers',
      color: '#14B8A6',
      gradient: 'linear-gradient(135deg, #134E4A, #14B8A6)',
    },
    {
      // 0 for every card until POST /icp/run has scored the data (or when
      // USE_LEGACY_EXCEL_PIPELINE is on, since Excel-sourced records never
      // carry isQualified/opportunityTier at all) — not an error state.
      id: 'icp-qualified',
      label: 'ICP Qualified',
      value: fmtNumber(kpis.icpQualifiedCount),
      rawValue: kpis.icpQualifiedCount,
      sub: kpis.totalCompanies ? `${Math.round((kpis.icpQualifiedCount / kpis.totalCompanies) * 100)}% of companies` : '—',
      icon: 'star',
      color: '#22C55E',
      gradient: 'linear-gradient(135deg, #14532D, #22C55E)',
    },
    {
      id: 'strategic-accounts',
      label: 'Strategic Accounts',
      value: fmtNumber(kpis.strategicAccountCount),
      rawValue: kpis.strategicAccountCount,
      sub: 'ICP Tier: Strategic',
      icon: 'trendUp',
      color: '#F59E0B',
      gradient: 'linear-gradient(135deg, #78350F, #F59E0B)',
    },
    {
      id: 'avg-ai',
      label: 'Avg AI Readiness',
      value: kpis.avgAILabel,
      sub: `Score: ${kpis.avgAIReadiness.toFixed(1)} / 3.0`,
      icon: 'zap',
      color: '#A855F7',
      gradient: 'linear-gradient(135deg, #581C87, #A855F7)',
      isBadge: true,
      badgeClass: badgeClassFor(kpis.avgAILabel),
    },
    {
      id: 'avg-cyber',
      label: 'Avg Cyber Score',
      value: kpis.avgCyberLabel,
      sub: `Score: ${kpis.avgCyberScore.toFixed(1)} / 3.0`,
      icon: 'shield',
      color: '#EF4444',
      gradient: 'linear-gradient(135deg, #7F1D1D, #EF4444)',
      isBadge: true,
      badgeClass: badgeClassFor(kpis.avgCyberLabel),
    },
    {
      id: 'avg-opp',
      label: 'Avg Opportunity',
      value: `${kpis.avgOpportunity}`,
      sub: 'Opportunity score / 100',
      icon: 'target',
      color: '#F59E0B',
      gradient: 'linear-gradient(135deg, #78350F, #F59E0B)',
      isProgress: true,
      progressPct: kpis.avgOpportunity,
    },
    {
      id: 'top-revenue',
      label: 'Highest Revenue',
      value: kpis.highestRevCompany,
      sub: fmtCurrency(kpis.highestRevValue),
      icon: 'star',
      color: '#10B981',
      gradient: 'linear-gradient(135deg, #065F46, #10B981)',
      isText: true,
    },
    {
      id: 'top-state',
      label: 'Top Opportunity State',
      value: kpis.topState,
      sub: `Score: ${kpis.topStateScore}`,
      icon: 'map',
      color: '#3B82F6',
      gradient: 'linear-gradient(135deg, #1E3A8A, #3B82F6)',
      isText: true,
    },
    {
      id: 'top-region',
      label: 'Top Opportunity Region',
      value: kpis.topRegion,
      sub: `Score: ${kpis.topRegionScore}`,
      icon: 'globe',
      color: '#0EA5E9',
      gradient: 'linear-gradient(135deg, #0C4A6E, #0EA5E9)',
      isText: true,
    },
    {
      id: 'top-sector',
      label: 'Top Opportunity Sector',
      value: kpis.topSector,
      sub: `Score: ${kpis.topSectorScore}`,
      icon: 'filter',
      color: '#F97316',
      gradient: 'linear-gradient(135deg, #7C2D12, #F97316)',
      isText: true,
    },
    {
      id: 'total-net-profit',
      label: 'Total Net Profit',
      value: fmtCurrency(kpis.totalNetProfit),
      rawValue: kpis.totalNetProfit,
      sub: kpis.netProfitCount > 0 ? `Avg ${fmtCurrency(kpis.avgNetProfit)} across ${kpis.netProfitCount.toLocaleString('en-IN')} companies` : 'No net profit data available',
      icon: 'dollar',
      color: '#22C55E',
      gradient: 'linear-gradient(135deg, #14532D, #22C55E)',
    },
    {
      id: 'district-coverage',
      label: 'District Coverage',
      value: fmtNumber(kpis.districtCoverage),
      rawValue: kpis.districtCoverage,
      sub: 'Distinct districts with branch presence',
      icon: 'map',
      color: '#6366F1',
      gradient: 'linear-gradient(135deg, #312E81, #6366F1)',
    },
  ];
}

function badgeClassFor(label) {
  if (label === 'High')   return 'kpi-badge-high';
  if (label === 'Medium') return 'kpi-badge-med';
  if (label === 'Low')    return 'kpi-badge-low';
  return 'kpi-badge-na';
}

// ─── Icon Helper ──────────────────────────

function svgIconMarkup(name) {
  const el = Icon(name);
  const tmp = document.createElement('div');
  tmp.appendChild(el);
  return tmp.innerHTML;
}

// ─── Card HTML ────────────────────────────

function renderCard(def, index) {
  const delay = index * 50;
  const sparkline = def.sparkData ? sparklineSVG(def.sparkData, def.color) : '';

  let valueHTML;
  if (def.isBadge) {
    valueHTML = `<span class="kpi-value-badge ${def.badgeClass}">${def.value}</span>`;
  } else if (def.isText) {
    valueHTML = `<span class="kpi-value kpi-value-text">${def.value}</span>`;
  } else {
    valueHTML = `<span class="kpi-value" data-target="${def.rawValue || 0}">${def.value}</span>`;
  }

  let progressBar = '';
  if (def.isProgress) {
    const pct = def.progressPct || 0;
    const barColor = pct >= 60 ? '#10B981' : pct >= 35 ? '#F59E0B' : '#EF4444';
    progressBar = `
      <div class="kpi-progress-wrap">
        <div class="kpi-progress-bar" style="width:${pct}%;background:${barColor}"></div>
      </div>`;
  }

  return `
    <div class="kpi-card glass-card kpi-exec-card kpi-anim" style="animation-delay:${delay}ms" data-kpi="${def.id}">
      <div class="kpi-card-inner">
        <div class="kpi-card-left">
          <div class="kpi-label" style="color:${def.color}">${def.label}</div>
          ${valueHTML}
          <div class="kpi-sub">${def.sub}</div>
          ${progressBar}
        </div>
        <div class="kpi-card-right">
          <div class="kpi-icon-wrap" style="background:${def.gradient}">
            ${svgIconMarkup(def.icon)}
          </div>
          ${sparkline ? `<div class="kpi-sparkline">${sparkline}</div>` : ''}
        </div>
      </div>
      <div class="kpi-glow" style="background:radial-gradient(circle at 80% 20%, ${def.color}15, transparent 60%)"></div>
    </div>`;
}

// ─── Counter Animation ────────────────────

function animateCounters(container) {
  const els = container.querySelectorAll('.kpi-value[data-target]');
  els.forEach(el => {
    const raw = el.textContent;
    // Only animate numeric-looking values
    if (!/[\d₹,.KLCr]/.test(raw)) return;

    // Add the animation class on viewport entry — but keep the real text
    // visible at all times so cards rendered inside currently-hidden
    // containers still show their correct value.
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        observer.disconnect();
        el.classList.add('kpi-counting');
      }
    }, { threshold: 0.3 });
    observer.observe(el);
  });
}

// ─── Render ───────────────────────────────

function renderKPIGrid(cache, records) {
  const grid = qs('#kpi-grid');
  if (!grid) return;

  const kpis = computeExecutiveKPIs(cache, records);
  if (!kpis) {
    grid.innerHTML = '<div class="kpi-empty">No data loaded.</div>';
    return;
  }

  const cards = buildCardDefs(kpis);
  grid.innerHTML = cards.map((c, i) => renderCard(c, i)).join('');

  // Trigger sparkline drawing animation
  requestAnimationFrame(() => {
    grid.querySelectorAll('.kpi-spark-line').forEach(line => {
      const len = line.getTotalLength?.() || 100;
      line.style.strokeDasharray = len;
      line.style.strokeDashoffset = len;
      line.classList.add('kpi-spark-animate');
    });
  });

  animateCounters(grid);
}

// ─── Public Init ──────────────────────────

let _cache = null;

export function initKPICards() {
  bus.on('data:ready', ({ cache }) => {
    _cache = cache;
    renderKPIGrid(cache);
  });

  bus.on('filter:apply', (filters) => {
    if (!_cache) return;
    renderKPIGrid(_cache, _cache.query(filters));
  });

  bus.on('filter:reset', () => {
    if (!_cache) return;
    renderKPIGrid(_cache);
  });
}
