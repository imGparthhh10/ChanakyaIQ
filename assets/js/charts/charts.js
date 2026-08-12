/**
 * charts.js — Full analytics engine using Apache ECharts.
 *
 * Renders 15 interactive charts across 4 tabs:
 *   Distribution: by State, Region, Sector
 *   Financial:    Revenue, IT Spend, Opportunity, Buying Window
 *   Readiness:    Cloud, Cyber, AI, Lead Priority
 *   Leaderboard:  Top Revenue, Opportunity, AI, IT Spend
 *
 * Supports drill-down, cross-filtering, animations,
 * theme switching (dark/light), and responsive resize.
 */

import { bus }            from '../utils/eventBus.js';
import { qs, qsa }       from '../utils/dom.js';
import { loadECharts }    from './echartsLoader.js';
import { getChartTheme }  from './chartTheme.js';

// ─── State ────────────────────────────────────────

let ec       = null;   // echarts namespace
let _cache   = null;
let _charts  = {};     // id → echarts instance
let _activeTab = 'distribution';

// ─── Helpers ──────────────────────────────────────

function countByField(records, field) {
  const map = {};
  for (const r of records) {
    const v = r[field];
    if (v) map[v] = (map[v] || 0) + 1;
  }
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}

function sumByField(records, groupField, sumField) {
  const map = {};
  for (const r of records) {
    const g = r[groupField];
    const v = r[sumField];
    if (g && v != null) map[g] = (map[g] || 0) + v;
  }
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}

function topN(records, field, n = 15) {
  return records
    .filter(r => r[field] != null && r[field] > 0)
    .sort((a, b) => b[field] - a[field])
    .slice(0, n);
}

function maturityCount(records, field) {
  const buckets = { High: 0, Medium: 0, Low: 0, Unknown: 0 };
  for (const r of records) {
    const v = (r[field] || '').trim();
    if (/high/i.test(v))        buckets.High++;
    else if (/med/i.test(v))    buckets.Medium++;
    else if (/low/i.test(v))    buckets.Low++;
    else                        buckets.Unknown++;
  }
  return buckets;
}

function fmt(n) {
  if (n >= 100000) return (n / 100000).toFixed(1) + 'L Cr';
  if (n >= 1000)   return (n / 1000).toFixed(1) + 'K Cr';
  return '₹' + n.toFixed(0) + ' Cr';
}

function fmtShort(n) {
  if (n >= 10000000) return (n / 10000000).toFixed(1) + 'Cr';
  if (n >= 100000)   return (n / 100000).toFixed(1) + 'L';
  if (n >= 1000)     return (n / 1000).toFixed(1) + 'K';
  return String(Math.round(n));
}

// ─── Chart Instance Management ────────────────────

function getOrCreate(id) {
  const el = qs(`#${id}`);
  if (!el) return null;

  if (_charts[id]) {
    return _charts[id];
  }

  el.innerHTML = '';
  const chart = ec.init(el, null, { renderer: 'canvas' });
  _charts[id] = chart;
  return chart;
}

function disposeAll() {
  for (const [id, chart] of Object.entries(_charts)) {
    try { chart.dispose(); } catch {}
  }
  _charts = {};
}

// ─── Sidebar Charts (always visible) ──────────────

function renderSidebarCharts(records) {
  renderSectorMix(records);
  renderRevenueDistribution(records);
  renderTopStates(records);
}

// Top N categories shown individually; the remainder is grouped into a single
// labelled "Other" slice rather than dropped. Keeps the legend to one page in
// a narrow card (10 individual entries paginated to 6 pages, which is what
// made the legend unreadable) without hiding any of the total from the chart.
const SECTOR_MIX_TOP_N = 6;

function groupTail(entries, topN) {
  if (entries.length <= topN) return entries;
  const head = entries.slice(0, topN);
  const tailTotal = entries.slice(topN).reduce((sum, [, value]) => sum + value, 0);
  return tailTotal > 0 ? [...head, ['Other', tailTotal]] : head;
}

function renderSectorMix(records) {
  const chart = getOrCreate('chart-sector-mix');
  if (!chart) return;
  const t = getChartTheme();
  const data = groupTail(countByField(records, 'category'), SECTOR_MIX_TOP_N);

  chart.setOption({
    color: t.palette,
    tooltip: { ...t.tooltip(), trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: { ...t.legend(), bottom: 0, type: 'scroll', itemGap: 10, padding: [0, 8] },
    series: [{
      type: 'pie',
      radius: ['42%', '68%'],
      center: ['50%', '42%'],
      avoidLabelOverlap: true,
      itemStyle: { borderRadius: 6, borderColor: t.darkMode ? '#0F172A' : '#fff', borderWidth: 2 },
      label: { show: false },
      emphasis: {
        label: { show: true, fontSize: 12, fontWeight: 600, fontFamily: "'DM Sans',sans-serif" },
        itemStyle: { shadowBlur: 20, shadowColor: 'rgba(0,0,0,0.3)' },
      },
      animationType: 'scale',
      animationEasing: 'elasticOut',
      animationDelay: (idx) => idx * 60,
      data: data.map(([name, value]) => ({ name, value })),
    }],
  }, true);

  chart.off('click');
  chart.on('click', (params) => {
    // 'Other' is a synthetic aggregate of the tail categories, not a real
    // `category` value — drilling into it would filter to zero records.
    if (params.name === 'Other') return;
    bus.emit('filter:apply', { category: params.name });
  });
}

function renderRevenueDistribution(records) {
  const chart = getOrCreate('chart-revenue-dist');
  if (!chart) return;
  const t = getChartTheme();
  const data = sumByField(records, 'category', 'revenue').slice(0, 8);

  chart.setOption({
    color: t.palette,
    tooltip: { ...t.tooltip(), trigger: 'axis', axisPointer: { type: 'shadow' } },
    // right:64 reserves room for the value label ("5.7L Cr" was being clipped
    // at the card edge at right:20).
    grid: { left: 10, right: 64, top: 10, bottom: 10, containLabel: true },
    xAxis: { type: 'value', show: false },
    yAxis: {
      type: 'category',
      data: data.map(d => d[0]).reverse(),
      ...t.axis(),
      // interval:0 forces every category label to render — without it ECharts
      // silently drops labels when rows get tight, leaving unlabelled bars.
      axisLabel: { ...t.axisLabel, interval: 0, width: 96, overflow: 'truncate' },
    },
    series: [{
      type: 'bar',
      data: data.map(d => d[1]).reverse(),
      barWidth: 14,
      itemStyle: { borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: 'right', fontSize: 10, fontFamily: "'DM Sans',sans-serif", color: t.textMuted, formatter: (p) => fmt(p.value) },
      animationDelay: (idx) => idx * 80,
    }],
  }, true);

  chart.off('click');
  chart.on('click', (params) => {
    bus.emit('filter:apply', { category: params.name });
  });
}

function renderTopStates(records) {
  const chart = getOrCreate('chart-top-states');
  if (!chart) return;
  const t = getChartTheme();
  const data = countByField(records, 'state').slice(0, 10);
  const max = data[0]?.[1] || 1;

  chart.setOption({
    tooltip: { ...t.tooltip(), trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 10, right: 44, top: 10, bottom: 10, containLabel: true },
    xAxis: { type: 'value', show: false },
    yAxis: {
      type: 'category',
      data: data.map(d => d[0]).reverse(),
      ...t.axis(),
      // interval:0 — this chart shows 10 states; without it ECharts was
      // rendering only ~5 labels against 10 bars (visible in the dashboard as
      // bars with no state name next to them).
      axisLabel: { ...t.axisLabel, interval: 0, width: 88, overflow: 'truncate' },
    },
    series: [{
      type: 'bar',
      data: data.map(d => d[1]).reverse(),
      barWidth: 12,
      itemStyle: {
        borderRadius: [0, 4, 4, 0],
        color: (p) => {
          const ratio = p.value / max;
          return {
            type: 'linear', x: 0, y: 0, x2: 1, y2: 0,
            colorStops: [
              { offset: 0, color: '#6366F1' },
              { offset: 1, color: ratio > 0.6 ? '#22D3EE' : '#818CF8' },
            ],
          };
        },
      },
      label: { show: true, position: 'right', fontSize: 10, fontFamily: "'DM Sans',sans-serif", color: t.textMuted },
      animationDelay: (idx) => idx * 60,
    }],
  }, true);

  chart.off('click');
  chart.on('click', (params) => {
    bus.emit('filter:apply', { state: params.name });
  });
}

// ═══════════════════════════════════════════════════
// TAB: Distribution
// ═══════════════════════════════════════════════════

function renderByState(records) {
  const chart = getOrCreate('ec-by-state');
  if (!chart) return;
  const t = getChartTheme();
  const data = countByField(records, 'state').slice(0, 20);
  const max = data[0]?.[1] || 1;

  chart.setOption({
    tooltip: { ...t.tooltip(), trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 10, right: 30, top: 20, bottom: 30, containLabel: true },
    xAxis: {
      type: 'category',
      data: data.map(d => d[0]),
      ...t.axis(),
      axisLabel: { ...t.axisLabel, rotate: 35, width: 70, overflow: 'truncate' },
    },
    yAxis: { type: 'value', ...t.axis() },
    series: [{
      type: 'bar',
      data: data.map(d => d[1]),
      barMaxWidth: 28,
      itemStyle: {
        borderRadius: [4, 4, 0, 0],
        color: {
          type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: '#6366F1' },
            { offset: 1, color: '#4338CA' },
          ],
        },
      },
      emphasis: { itemStyle: { shadowBlur: 12, shadowColor: 'rgba(99,102,241,0.4)' } },
      animationDelay: (idx) => idx * 40,
    }],
    dataZoom: data.length > 12 ? [{ type: 'inside', start: 0, end: 60 }] : [],
  }, true);

  chart.off('click');
  chart.on('click', (params) => bus.emit('filter:apply', { state: params.name }));
}

function renderByRegion(records) {
  const chart = getOrCreate('ec-by-region');
  if (!chart) return;
  const t = getChartTheme();
  const data = countByField(records, 'region');

  chart.setOption({
    color: ['#6366F1', '#22D3EE', '#10B981', '#F59E0B', '#F43F5E', '#8B5CF6', '#3B82F6', '#14B8A6'],
    tooltip: { ...t.tooltip(), trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: { ...t.legend(), bottom: 0, type: 'scroll' },
    series: [{
      type: 'pie',
      radius: ['35%', '65%'],
      center: ['50%', '45%'],
      roseType: 'area',
      itemStyle: { borderRadius: 6, borderColor: t.darkMode ? '#0F172A' : '#fff', borderWidth: 2 },
      label: { show: false },
      emphasis: {
        label: { show: true, fontSize: 13, fontWeight: 600, fontFamily: "'DM Sans',sans-serif" },
        itemStyle: { shadowBlur: 20, shadowColor: 'rgba(0,0,0,0.3)' },
      },
      animationType: 'scale',
      animationEasing: 'elasticOut',
      animationDelay: (idx) => idx * 80,
      data: data.map(([name, value]) => ({ name, value })),
    }],
  }, true);

  chart.off('click');
  chart.on('click', (params) => bus.emit('filter:apply', { region: params.name }));
}

function renderBySector(records) {
  const chart = getOrCreate('ec-by-sector');
  if (!chart) return;
  const t = getChartTheme();
  const data = countByField(records, 'category');

  chart.setOption({
    color: t.palette,
    tooltip: { ...t.tooltip(), trigger: 'item', formatter: '{b}<br/>Companies: <b>{c}</b> ({d}%)' },
    series: [{
      type: 'treemap',
      width: '94%',
      height: '85%',
      top: 10,
      roam: false,
      nodeClick: 'link',
      breadcrumb: { show: false },
      label: { fontFamily: "'DM Sans',sans-serif", fontSize: 11, fontWeight: 600, color: '#fff' },
      upperLabel: { show: false },
      itemStyle: { borderColor: t.darkMode ? '#0F172A' : '#fff', borderWidth: 2, gapWidth: 2, borderRadius: 4 },
      levels: [{
        itemStyle: { borderColor: t.darkMode ? '#1E293B' : '#E2E8F0', borderWidth: 3, gapWidth: 3 },
      }],
      animationDuration: 800,
      animationEasing: 'cubicOut',
      data: data.map(([name, value], i) => ({
        name, value,
        itemStyle: { color: t.palette[i % t.palette.length] },
      })),
    }],
  }, true);

  chart.off('click');
  chart.on('click', (params) => {
    if (params.data?.name) bus.emit('filter:apply', { category: params.data.name });
  });
}

// ═══════════════════════════════════════════════════
// TAB: Financial
// ═══════════════════════════════════════════════════

function renderRevenue(records) {
  const chart = getOrCreate('ec-revenue');
  if (!chart) return;
  const t = getChartTheme();
  const data = sumByField(records, 'category', 'revenue').slice(0, 12);

  chart.setOption({
    tooltip: {
      ...t.tooltip(), trigger: 'axis', axisPointer: { type: 'shadow' },
      formatter: (params) => {
        const p = params[0];
        return `<b>${p.name}</b><br/>Revenue: <b>${fmt(p.value)}</b>`;
      },
    },
    grid: { left: 10, right: 20, top: 20, bottom: 30, containLabel: true },
    xAxis: {
      type: 'category',
      data: data.map(d => d[0]),
      ...t.axis(),
      axisLabel: { ...t.axisLabel, rotate: 30, width: 80, overflow: 'truncate' },
    },
    yAxis: { type: 'value', ...t.axis(), axisLabel: { ...t.axisLabel, formatter: (v) => fmtShort(v) } },
    series: [{
      type: 'bar',
      data: data.map((d, i) => ({
        value: d[1],
        itemStyle: {
          color: {
            type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: t.palette[i % t.palette.length] },
              { offset: 1, color: t.palette[i % t.palette.length] + '80' },
            ],
          },
          borderRadius: [6, 6, 0, 0],
        },
      })),
      barMaxWidth: 36,
      emphasis: { itemStyle: { shadowBlur: 16, shadowColor: 'rgba(99,102,241,0.35)' } },
      animationDelay: (idx) => idx * 60,
    }],
  }, true);
}

function renderITSpend(records) {
  const chart = getOrCreate('ec-it-spend');
  if (!chart) return;
  const t = getChartTheme();
  const data = sumByField(records, 'region', 'itSpend').filter(d => d[1] > 0);

  chart.setOption({
    color: ['#22D3EE', '#6366F1', '#10B981', '#F59E0B', '#F43F5E', '#8B5CF6', '#3B82F6'],
    tooltip: {
      ...t.tooltip(), trigger: 'item',
      formatter: (p) => `<b>${p.name}</b><br/>IT Spend: <b>${fmt(p.value)}</b> (${p.percent}%)`,
    },
    legend: { ...t.legend(), bottom: 0, type: 'scroll' },
    series: [{
      type: 'pie',
      radius: ['30%', '65%'],
      center: ['50%', '45%'],
      avoidLabelOverlap: true,
      itemStyle: { borderRadius: 8, borderColor: t.darkMode ? '#0F172A' : '#fff', borderWidth: 2 },
      label: { show: false },
      emphasis: {
        label: { show: true, fontSize: 13, fontWeight: 600, fontFamily: "'DM Sans',sans-serif" },
        itemStyle: { shadowBlur: 20, shadowColor: 'rgba(0,0,0,0.3)' },
        scaleSize: 8,
      },
      animationType: 'scale',
      animationEasing: 'elasticOut',
      data: data.map(([name, value]) => ({ name, value })),
    }],
  }, true);
}

function renderOpportunity(records) {
  const chart = getOrCreate('ec-opportunity');
  if (!chart) return;
  const t = getChartTheme();

  const buckets = { 'High (70+)': 0, 'Medium (40-69)': 0, 'Low (< 40)': 0, 'No Data': 0 };
  for (const r of records) {
    const v = r.buyingPotential;
    if (v == null)  buckets['No Data']++;
    else if (v >= 70) buckets['High (70+)']++;
    else if (v >= 40) buckets['Medium (40-69)']++;
    else              buckets['Low (< 40)']++;
  }

  const colors = ['#10B981', '#F59E0B', '#EF4444', '#64748B'];
  const data = Object.entries(buckets).filter(d => d[1] > 0);

  chart.setOption({
    color: colors,
    tooltip: { ...t.tooltip(), trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: { ...t.legend(), bottom: 0 },
    series: [{
      type: 'pie',
      radius: ['38%', '68%'],
      center: ['50%', '42%'],
      itemStyle: { borderRadius: 6, borderColor: t.darkMode ? '#0F172A' : '#fff', borderWidth: 2 },
      label: { show: false },
      emphasis: {
        label: { show: true, fontSize: 13, fontWeight: 600, fontFamily: "'DM Sans',sans-serif" },
        itemStyle: { shadowBlur: 20, shadowColor: 'rgba(0,0,0,0.3)' },
      },
      animationType: 'scale',
      animationEasing: 'elasticOut',
      data: data.map(([name, value]) => ({ name, value })),
    }],
  }, true);
}

function renderBuyingWindow(records) {
  const chart = getOrCreate('ec-buying-window');
  if (!chart) return;
  const t = getChartTheme();

  const buckets = {};
  for (const r of records) {
    const v = r.buyingPotential;
    if (v == null || v <= 0) continue;
    let bracket;
    if (v < 1)       bracket = '< ₹1 Cr';
    else if (v < 5)  bracket = '₹1-5 Cr';
    else if (v < 10) bracket = '₹5-10 Cr';
    else if (v < 50) bracket = '₹10-50 Cr';
    else if (v < 100) bracket = '₹50-100 Cr';
    else              bracket = '₹100+ Cr';
    buckets[bracket] = (buckets[bracket] || 0) + 1;
  }

  const order = ['< ₹1 Cr', '₹1-5 Cr', '₹5-10 Cr', '₹10-50 Cr', '₹50-100 Cr', '₹100+ Cr'];
  const sortedData = order.filter(k => buckets[k]).map(k => [k, buckets[k]]);

  chart.setOption({
    tooltip: { ...t.tooltip(), trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 10, right: 20, top: 20, bottom: 30, containLabel: true },
    xAxis: {
      type: 'category',
      data: sortedData.map(d => d[0]),
      ...t.axis(),
    },
    yAxis: { type: 'value', ...t.axis() },
    series: [{
      type: 'bar',
      data: sortedData.map((d, i) => ({
        value: d[1],
        itemStyle: {
          borderRadius: [6, 6, 0, 0],
          color: {
            type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: '#F59E0B' },
              { offset: 1, color: '#D97706' },
            ],
          },
        },
      })),
      barMaxWidth: 40,
      emphasis: { itemStyle: { shadowBlur: 12, shadowColor: 'rgba(245,158,11,0.4)' } },
      animationDelay: (idx) => idx * 80,
    }],
  }, true);
}

// ═══════════════════════════════════════════════════
// TAB: Readiness
// ═══════════════════════════════════════════════════

function renderMaturityGauge(id, records, field, colors) {
  const chart = getOrCreate(id);
  if (!chart) return;
  const t = getChartTheme();
  const buckets = maturityCount(records, field);
  const data = [
    { value: buckets.High,    name: 'High',    itemStyle: { color: colors[0] } },
    { value: buckets.Medium,  name: 'Medium',  itemStyle: { color: colors[1] } },
    { value: buckets.Low,     name: 'Low',     itemStyle: { color: colors[2] } },
  ];
  if (buckets.Unknown > 0) {
    data.push({ value: buckets.Unknown, name: 'Unknown', itemStyle: { color: '#475569' } });
  }

  chart.setOption({
    tooltip: { ...t.tooltip(), trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: { ...t.legend(), bottom: 0 },
    series: [{
      type: 'pie',
      radius: ['42%', '72%'],
      center: ['50%', '42%'],
      startAngle: 180,
      itemStyle: { borderRadius: 6, borderColor: t.darkMode ? '#0F172A' : '#fff', borderWidth: 2 },
      label: {
        show: true,
        position: 'inside',
        fontSize: 11,
        fontWeight: 700,
        fontFamily: "'DM Sans',sans-serif",
        color: '#fff',
        formatter: (p) => p.percent > 8 ? `${Math.round(p.percent)}%` : '',
      },
      emphasis: {
        label: { fontSize: 14 },
        itemStyle: { shadowBlur: 20, shadowColor: 'rgba(0,0,0,0.3)' },
      },
      animationType: 'scale',
      animationEasing: 'elasticOut',
      animationDelay: (idx) => idx * 100,
      data,
    }],
  }, true);
}

function renderCloud(records)  { renderMaturityGauge('ec-cloud', records, 'cloudMaturity', ['#3B82F6', '#F59E0B', '#EF4444']); }
function renderCyber(records)  { renderMaturityGauge('ec-cyber', records, 'cyberMaturity', ['#10B981', '#F59E0B', '#EF4444']); }
function renderAI(records)     { renderMaturityGauge('ec-ai',    records, 'aiReadiness',   ['#8B5CF6', '#F59E0B', '#EF4444']); }

function renderLeadPriority(records) {
  const chart = getOrCreate('ec-lead-priority');
  if (!chart) return;
  const t = getChartTheme();

  const byRegion = {};
  for (const r of records) {
    const region = r.region || 'Unknown';
    const cloud  = (r.cloudMaturity || '').toLowerCase();
    if (!byRegion[region]) byRegion[region] = { High: 0, Medium: 0, Low: 0 };
    if (/high/i.test(cloud))   byRegion[region].High++;
    else if (/med/i.test(cloud)) byRegion[region].Medium++;
    else                        byRegion[region].Low++;
  }

  const regions = Object.keys(byRegion).sort();
  const highData   = regions.map(r => byRegion[r].High);
  const medData    = regions.map(r => byRegion[r].Medium);
  const lowData    = regions.map(r => byRegion[r].Low);

  chart.setOption({
    tooltip: { ...t.tooltip(), trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { ...t.legend(), top: 0, data: ['High', 'Medium', 'Low'] },
    grid: { left: 10, right: 20, top: 40, bottom: 30, containLabel: true },
    xAxis: {
      type: 'category',
      data: regions,
      ...t.axis(),
      axisLabel: { ...t.axisLabel, rotate: 20 },
    },
    yAxis: { type: 'value', ...t.axis() },
    series: [
      { name: 'High',   type: 'bar', stack: 'total', data: highData,   itemStyle: { color: '#10B981', borderRadius: [0,0,0,0] }, barMaxWidth: 32 },
      { name: 'Medium', type: 'bar', stack: 'total', data: medData,    itemStyle: { color: '#F59E0B' }, barMaxWidth: 32 },
      { name: 'Low',    type: 'bar', stack: 'total', data: lowData,    itemStyle: { color: '#EF4444', borderRadius: [4,4,0,0] }, barMaxWidth: 32 },
    ],
    animationDelay: (idx) => idx * 40,
  }, true);
}

// ═══════════════════════════════════════════════════
// TAB: Leaderboard
// ═══════════════════════════════════════════════════

function renderLeaderboard(id, records, field, label, color1, color2) {
  const chart = getOrCreate(id);
  if (!chart) return;
  const t = getChartTheme();
  const top = topN(records, field, 15);

  const names = top.map(r => r.companyName || 'Unknown').reverse();
  const values = top.map(r => r[field]).reverse();
  const max = values[values.length - 1] || 1;

  chart.setOption({
    tooltip: {
      ...t.tooltip(), trigger: 'axis', axisPointer: { type: 'shadow' },
      formatter: (params) => {
        const p = params[0];
        const idx = names.length - 1 - p.dataIndex;
        const rec = top[top.length - 1 - p.dataIndex];
        return `<b>${p.name}</b><br/>${label}: <b>${field === 'revenue' || field === 'itSpend' ? fmt(p.value) : fmtShort(p.value)}</b>${rec?.category ? '<br/>Sector: ' + rec.category : ''}`;
      },
    },
    grid: { left: 10, right: 40, top: 10, bottom: 10, containLabel: true },
    xAxis: { type: 'value', show: false },
    yAxis: {
      type: 'category',
      data: names,
      ...t.axis(),
      axisLabel: { ...t.axisLabel, width: 120, overflow: 'truncate' },
    },
    series: [{
      type: 'bar',
      data: values.map((v, i) => ({
        value: v,
        itemStyle: {
          borderRadius: [0, 6, 6, 0],
          color: {
            type: 'linear', x: 0, y: 0, x2: 1, y2: 0,
            colorStops: [
              { offset: 0, color: color1 },
              { offset: 1, color: color2 },
            ],
          },
        },
      })),
      barWidth: 14,
      label: {
        show: true,
        position: 'right',
        fontSize: 10,
        fontFamily: "'DM Sans',sans-serif",
        color: t.textMuted,
        formatter: (p) => field === 'revenue' || field === 'itSpend' ? fmt(p.value) : fmtShort(p.value),
      },
      emphasis: { itemStyle: { shadowBlur: 12, shadowColor: color1 + '60' } },
      animationDelay: (idx) => idx * 50,
    }],
  }, true);

  chart.off('click');
  chart.on('click', (params) => {
    const rec = top[top.length - 1 - params.dataIndex];
    if (rec && rec._dedupeKey) {
      location.hash = '#/company/' + encodeURIComponent(rec._dedupeKey);
    } else if (rec) {
      bus.emit('company:select', rec);
    }
  });
}

function renderTopRevenue(r)     { renderLeaderboard('ec-top-revenue',     r, 'revenue',        'Revenue',    '#6366F1', '#22D3EE'); }
function renderTopOpportunity(r) { renderLeaderboard('ec-top-opportunity', r, 'buyingPotential', 'Potential',  '#10B981', '#22D3EE'); }
function renderTopAI(r)          { renderLeaderboard('ec-top-ai',          r, 'marketCap',       'Market Cap', '#8B5CF6', '#EC4899'); }
function renderTopITSpend(r)     { renderLeaderboard('ec-top-it-spend',    r, 'itSpend',         'IT Spend',   '#F59E0B', '#F97316'); }

// ═══════════════════════════════════════════════════
// Tab Switching
// ═══════════════════════════════════════════════════

function wireTabBar() {
  const tabs = qsa('.chart-tab');
  const panels = qsa('.chart-panel');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabId = tab.dataset.tab;
      if (tabId === _activeTab) return;

      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      panels.forEach(p => p.classList.remove('active'));
      const panel = qs(`#panel-${tabId}`);
      if (panel) panel.classList.add('active');

      _activeTab = tabId;
      renderActiveTab(_cache?.getAll() || []);
    });
  });
}

function renderActiveTab(records) {
  requestAnimationFrame(() => {
    switch (_activeTab) {
      case 'distribution':
        renderByState(records);
        renderByRegion(records);
        renderBySector(records);
        break;
      case 'financial':
        renderRevenue(records);
        renderITSpend(records);
        renderOpportunity(records);
        renderBuyingWindow(records);
        break;
      case 'readiness':
        renderCloud(records);
        renderCyber(records);
        renderAI(records);
        renderLeadPriority(records);
        break;
      case 'leaderboard':
        renderTopRevenue(records);
        renderTopOpportunity(records);
        renderTopAI(records);
        renderTopITSpend(records);
        break;
    }

    // Resize visible charts
    setTimeout(() => {
      for (const chart of Object.values(_charts)) {
        try { chart.resize(); } catch {}
      }
    }, 50);
  });
}

// ─── Render All ───────────────────────────────────

function renderAllCharts(records) {
  renderSidebarCharts(records);
  renderActiveTab(records);
}

// ─── Resize Handler ───────────────────────────────

let _resizeTimer = null;
function onResize() {
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(() => {
    for (const chart of Object.values(_charts)) {
      try { chart.resize(); } catch {}
    }
  }, 200);
}

// ─── Theme Change Handler ─────────────────────────

function onThemeChange() {
  if (!_cache) return;
  const records = _cache.getAll();
  renderAllCharts(records);
}

// The Analytics page is a persistent container (router.js) — hidden
// (display:none) whenever it isn't the active route, including at boot if
// Home is the landing page. Chart instances created via getOrCreate() while
// hidden get initialized against a zero-size container (qs() still finds
// hidden elements, ec.init() doesn't know they're invisible), so they need
// the same resize() pass onResize() already does for window resizes,
// triggered instead by navigating into view.
function onRouteChange({ path }) {
  if (path !== '/analytics') return;
  for (const chart of Object.values(_charts)) {
    try { chart.resize(); } catch {}
  }
}

// ═══════════════════════════════════════════════════
// Public Init
// ═══════════════════════════════════════════════════

export async function initCharts() {
  try {
    ec = await loadECharts();
  } catch (err) {
    console.error('[Charts] Failed to load ECharts:', err);
    return;
  }

  wireTabBar();
  window.addEventListener('resize', onResize);

  bus.on('data:ready', ({ cache }) => {
    _cache = cache;
    renderAllCharts(cache.getAll());
  });

  bus.on('filter:apply', (filters) => {
    if (!_cache) return;
    const filtered = _cache.query(filters);
    renderAllCharts(filtered);
  });

  bus.on('filter:reset', () => {
    if (!_cache) return;
    renderAllCharts(_cache.getAll());
  });

  bus.on('theme:change', onThemeChange);
  bus.on('route:change', onRouteChange);
}
