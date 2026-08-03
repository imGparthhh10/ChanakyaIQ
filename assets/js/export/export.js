/**
 * export.js — Export module.
 *
 * Supports:
 *   - CSV export (filtered dataset)
 *   - Excel export (filtered dataset, formatted worksheet)
 *   - PDF export (single Company Report, or Filtered Report table)
 *   - PNG export (Dashboard Snapshot via html2canvas)
 *   - Print (browser print of current dashboard view)
 *
 * Opens as a lightweight modal triggered from the page header
 * "Export" button, or programmatically via bus 'export:company'.
 */

import { bus }        from '../utils/eventBus.js';
import { qs, h }     from '../utils/dom.js';
import { Icon }        from '../components/icons.js';
import { loadXLSX, loadJsPDF, loadHtml2Canvas } from './exportLoader.js';
import { EXPORT_COLUMNS, recordsToRows, rowsToCSV, downloadBlob, timestampedName, fmtCurrency } from './formatters.js';
import { trapFocus, announce } from '../utils/a11y.js';

// ─── State ────────────────────────────────────────

let _cache        = null;
let _activeFilters = {};
let _singleCompany = null; // set when exporting one company's report
let _releaseFocus  = null;

// ─── Helpers ──────────────────────────────────────

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

function currentRecords() {
  if (!_cache) return [];
  return Object.keys(_activeFilters).length ? _cache.query(_activeFilters) : _cache.getAll();
}

function showToast(msg) {
  const host = qs('#toast-host');
  if (!host) return;
  const toast = h('div', { class: 'ef-toast glass-card' }, msg);
  host.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 2600);
}

// ═══════════════════════════════════════════════════
// CSV Export
// ═══════════════════════════════════════════════════

function exportCSV(records) {
  const rows = recordsToRows(records);
  const csv  = rowsToCSV(rows);
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, timestampedName('ESDS_BFSI_Filtered_Report', 'csv'));
  showToast(`CSV exported — ${records.length} companies`);
}

// ═══════════════════════════════════════════════════
// Excel Export
// ═══════════════════════════════════════════════════

async function exportExcel(records) {
  const XLSX = await loadXLSX();
  const rows = recordsToRows(records);

  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Column widths tuned per field
  ws['!cols'] = EXPORT_COLUMNS.map(([label]) => ({
    wch: Math.max(label.length + 2, 14),
  }));

  // Freeze header row
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'BFSI Companies');

  XLSX.writeFile(wb, timestampedName('ESDS_BFSI_Filtered_Report', 'xlsx'));
  showToast(`Excel exported — ${records.length} companies`);
}

// ═══════════════════════════════════════════════════
// PDF Export — Filtered Report (tabular)
// ═══════════════════════════════════════════════════

async function exportFilteredPDF(records) {
  const jsPDF = await loadJsPDF();
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });

  const pageW = doc.internal.pageSize.getWidth();
  const margin = 32;
  let y = margin;

  // Header
  doc.setFillColor(30, 64, 175);
  doc.rect(0, 0, pageW, 56, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('ESDS BFSI Geo Intelligence — Filtered Report', margin, 34);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`Generated ${new Date().toLocaleString('en-IN')} · ${records.length} companies`, margin, 48);

  y = 80;
  doc.setTextColor(30, 41, 59);

  const cols = ['Company', 'Category', 'State', 'Revenue (Cr)', 'Employees', 'CEO', 'Cloud', 'AI', 'Cyber'];
  const colW = [150, 95, 80, 70, 65, 110, 55, 55, 55];
  const startX = margin;

  function drawHeader() {
    doc.setFillColor(241, 245, 249);
    doc.rect(startX, y, colW.reduce((a, b) => a + b, 0), 20, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(51, 65, 85);
    let x = startX + 4;
    cols.forEach((c, i) => { doc.text(c, x, y + 13); x += colW[i]; });
    y += 20;
  }

  drawHeader();
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);

  for (const r of records) {
    if (y > doc.internal.pageSize.getHeight() - 40) {
      doc.addPage();
      y = margin;
      drawHeader();
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
    }

    const vals = [
      (r.companyName || '').slice(0, 28),
      (r.category || '').slice(0, 18),
      (r.state || '').slice(0, 14),
      r.revenue != null ? r.revenue.toLocaleString('en-IN') : '—',
      r.employeeCount != null ? r.employeeCount.toLocaleString('en-IN') : '—',
      (r.ceo || '—').slice(0, 20),
      r.cloudMaturity || '—',
      r.aiReadiness || '—',
      r.cyberMaturity || '—',
    ];

    doc.setTextColor(30, 41, 59);
    let x = startX + 4;
    vals.forEach((v, i) => { doc.text(String(v), x, y + 11); x += colW[i]; });

    doc.setDrawColor(226, 232, 240);
    doc.line(startX, y + 16, startX + colW.reduce((a, b) => a + b, 0), y + 16);
    y += 16;
  }

  // Footer page numbers
  const pageCount = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(`Page ${p} of ${pageCount}`, pageW - margin - 60, doc.internal.pageSize.getHeight() - 16);
    doc.text('ESDS BFSI Geo Intelligence Dashboard', margin, doc.internal.pageSize.getHeight() - 16);
  }

  doc.save(timestampedName('ESDS_BFSI_Filtered_Report', 'pdf'));
  showToast(`PDF report exported — ${records.length} companies`);
}

// ═══════════════════════════════════════════════════
// PDF Export — Single Company Report
// ═══════════════════════════════════════════════════

async function exportCompanyPDF(rec) {
  const jsPDF = await loadJsPDF();
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 40;
  let y = 0;

  // Header band
  doc.setFillColor(30, 64, 175);
  doc.rect(0, 0, pageW, 90, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text(rec.companyName || 'Company Report', margin, 44);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text([rec.category, rec.subSector, rec.state].filter(Boolean).join('  ·  '), margin, 62);
  doc.setFontSize(8);
  doc.text(`ESDS BFSI Geo Intelligence Dashboard — Generated ${new Date().toLocaleString('en-IN')}`, margin, 78);

  y = 118;
  doc.setTextColor(30, 41, 59);

  function sectionTitle(title) {
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 64, 175);
    doc.text(title, margin, y);
    doc.setDrawColor(224, 231, 255);
    doc.line(margin, y + 4, pageW - margin, y + 4);
    y += 20;
    doc.setTextColor(30, 41, 59);
    doc.setFont('helvetica', 'normal');
  }

  function field(label, value, xOffset = 0, width = 250) {
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(label.toUpperCase(), margin + xOffset, y);
    doc.setFontSize(10.5);
    doc.setTextColor(30, 41, 59);
    doc.text(String(value ?? '—'), margin + xOffset, y + 13);
  }

  function fieldRow(pairs) {
    const width = (pageW - margin * 2) / pairs.length;
    pairs.forEach((p, i) => field(p[0], p[1], i * width, width));
    y += 30;
  }

  // Overview
  sectionTitle('Company Overview');
  fieldRow([['Ownership', rec.ownership], ['Listed Status', rec.listedStatus], ['Year Founded', rec.yearFounded]]);
  fieldRow([['Region', rec.region], ['City', rec.hqCity], ['Website', rec.website]]);

  // Financials
  sectionTitle('Financial Profile');
  fieldRow([['Revenue', fmtCurrency(rec.revenue)], ['Net Profit', fmtCurrency(rec.netProfit)], ['Market Cap', fmtCurrency(rec.marketCap)]]);
  fieldRow([['Employees', rec.employeeCount?.toLocaleString('en-IN')], ['IT Spend', fmtCurrency(rec.itSpend)], ['Cloud Spend', fmtCurrency(rec.cloudSpend)]]);

  // Leadership
  sectionTitle('Leadership');
  fieldRow([['CEO / MD', rec.ceo], ['CTO', rec.cto], ['CIO', rec.cio]]);
  fieldRow([['CISO', rec.ciso], ['Chairman', rec.chairman], ['CFO', rec.cfo]]);

  // Maturity
  sectionTitle('Technology Maturity');
  fieldRow([['Cloud Maturity', rec.cloudMaturity], ['AI Readiness', rec.aiReadiness], ['Cyber Maturity', rec.cyberMaturity]]);
  fieldRow([['Digital Maturity', rec.digitalMaturity], ['Core Platform', rec.corePlatform], ['Buying Potential', fmtCurrency(rec.buyingPotential)]]);

  // Pain points / notes (wrapped text)
  if (rec.painPoints) {
    sectionTitle('Pain Points & Initiatives');
    doc.setFontSize(9.5);
    const lines = doc.splitTextToSize(rec.painPoints, pageW - margin * 2);
    doc.text(lines, margin, y);
    y += lines.length * 12 + 12;
  }

  if (rec.notes) {
    if (y > doc.internal.pageSize.getHeight() - 100) { doc.addPage(); y = margin; }
    sectionTitle('Notes');
    doc.setFontSize(9.5);
    const lines = doc.splitTextToSize(rec.notes, pageW - margin * 2);
    doc.text(lines, margin, y);
    y += lines.length * 12 + 12;
  }

  // Footer
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text('ESDS BFSI Geo Intelligence Dashboard — Confidential', margin, doc.internal.pageSize.getHeight() - 20);

  doc.save(timestampedName(`ESDS_Company_${(rec.companyName || 'Report').replace(/[^a-z0-9]+/gi, '_')}`, 'pdf'));
  showToast(`Company report exported — ${rec.companyName}`);
}

// ═══════════════════════════════════════════════════
// PNG Export — Dashboard Snapshot
// ═══════════════════════════════════════════════════

async function exportPNG(targetSelector = '#main') {
  const html2canvas = await loadHtml2Canvas();
  const target = qs(targetSelector);
  if (!target) return;

  showToast('Capturing dashboard snapshot…');

  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const canvas = await html2canvas(target, {
    backgroundColor: isDark ? '#0B1120' : '#F8FAFC',
    scale: Math.min(window.devicePixelRatio || 1, 2),
    useCORS: true,
    logging: false,
  });

  canvas.toBlob((blob) => {
    if (blob) {
      downloadBlob(blob, timestampedName('ESDS_BFSI_Dashboard_Snapshot', 'png'));
      showToast('Dashboard snapshot saved as PNG');
    }
  }, 'image/png');
}

// ═══════════════════════════════════════════════════
// Print
// ═══════════════════════════════════════════════════

function printDashboard() {
  window.print();
}

// ═══════════════════════════════════════════════════
// Export Modal UI
// ═══════════════════════════════════════════════════

const EXPORT_OPTIONS = [
  { id: 'csv',     icon: 'download', label: 'CSV',   desc: 'Comma-separated values of filtered companies', action: () => exportCSV(currentRecords()) },
  { id: 'excel',   icon: 'layers',   label: 'Excel', desc: 'Formatted .xlsx workbook with column widths', action: () => exportExcel(currentRecords()) },
  { id: 'pdf',     icon: 'download', label: 'PDF — Filtered Report', desc: 'Tabular PDF of all companies matching current filters', action: () => exportFilteredPDF(currentRecords()) },
  { id: 'pdf-co',  icon: 'building', label: 'PDF — Company Report', desc: 'Full intelligence profile for a single selected company', action: () => exportSingleCompanyFlow() },
  { id: 'png',     icon: 'zap',      label: 'PNG — Dashboard Snapshot', desc: 'High-resolution image of the current dashboard view', action: () => exportPNG() },
  { id: 'print',   icon: 'external', label: 'Print', desc: 'Open browser print dialog for the current view', action: () => printDashboard() },
];

function exportSingleCompanyFlow() {
  if (_singleCompany) {
    exportCompanyPDF(_singleCompany);
    return;
  }
  showToast('Select a company from the map or table first, then use "Export Report" in its detail panel.');
}

function openExportModal() {
  let overlay = qs('#exp-overlay');
  if (overlay) overlay.remove();

  overlay = h('div', {
    class: 'exp-overlay',
    id: 'exp-overlay',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'exp-modal-title',
  });
  const modal = h('div', { class: 'exp-modal glass-panel' });

  const header = h('div', { class: 'exp-modal-header' }, [
    h('div', {}, [
      h('h3', { class: 'exp-modal-title', id: 'exp-modal-title' }, 'Export Data'),
      h('p', { class: 'exp-modal-sub' }, `${currentRecords().length} companies in current view`),
    ]),
    h('button', { class: 'icon-btn', 'aria-label': 'Close export dialog', html: '✕', onclick: closeExportModal }),
  ]);

  const grid = h('div', { class: 'exp-option-grid' });
  for (const opt of EXPORT_OPTIONS) {
    const card = h('button', { class: 'exp-option-card' }, [
      h('div', { class: 'exp-option-icon', html: iconHtml(opt.icon) }),
      h('div', { class: 'exp-option-info' }, [
        h('span', { class: 'exp-option-label' }, opt.label),
        h('span', { class: 'exp-option-desc' }, opt.desc),
      ]),
    ]);
    card.addEventListener('click', async () => {
      card.classList.add('exp-loading');
      try { await opt.action(); } catch (err) { console.error('[Export]', err); showToast('Export failed — see console'); }
      card.classList.remove('exp-loading');
      closeExportModal();
    });
    grid.appendChild(card);
  }

  modal.appendChild(header);
  modal.appendChild(grid);
  overlay.appendChild(modal);

  const triggerEl = document.activeElement;
  document.body.appendChild(overlay);

  requestAnimationFrame(() => overlay.classList.add('open'));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeExportModal(); });

  _releaseFocus = trapFocus(overlay, { restore: triggerEl });
  announce('Export dialog opened.', 'polite');
}

function closeExportModal() {
  const overlay = qs('#exp-overlay');
  if (!overlay) return;
  overlay.classList.remove('open');
  if (_releaseFocus) { _releaseFocus(); _releaseFocus = null; }
  setTimeout(() => overlay.remove(), 250);
}

// ═══════════════════════════════════════════════════
// Public Init
// ═══════════════════════════════════════════════════

export function initExport() {
  bus.on('data:ready', ({ cache }) => { _cache = cache; });
  bus.on('filter:apply', (filters) => { _activeFilters = filters || {}; });
  bus.on('filter:reset', () => { _activeFilters = {}; });
  bus.on('company:select', (rec) => { _singleCompany = rec; });

  const exportBtn = qs('[data-action="export"]');
  exportBtn?.addEventListener('click', openExportModal);

  // Programmatic single-company export (e.g. from drawer "Export Report" button)
  bus.on('export:company', (rec) => {
    if (rec) exportCompanyPDF(rec);
  });

  bus.on('export:open', openExportModal);
}
