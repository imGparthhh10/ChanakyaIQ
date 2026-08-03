/**
 * formatters.js — Shared field extraction and formatting helpers
 * for CSV, Excel, and PDF exports. Keeps a single canonical column
 * set so every export format stays in sync.
 */

/** Canonical export columns: [header, recordKey, formatter?] */
export const EXPORT_COLUMNS = [
  ['Company Name',       'companyName'],
  ['Category',           'category'],
  ['Sub Sector',         'subSector'],
  ['Ownership',          'ownership'],
  ['Listed Status',      'listedStatus'],
  ['State',              'state'],
  ['Region',             'region'],
  ['City',               'hqCity'],
  ['Revenue (₹ Cr)',     'revenue'],
  ['Net Profit (₹ Cr)',  'netProfit'],
  ['Market Cap (₹ Cr)',  'marketCap'],
  ['Employees',          'employeeCount'],
  ['CEO / MD',           'ceo'],
  ['CTO',                'cto'],
  ['CIO',                'cio'],
  ['CISO',                'ciso'],
  ['IT Spend (₹ Cr)',    'itSpend'],
  ['Cloud Spend (₹ Cr)', 'cloudSpend'],
  ['Cyber Spend (₹ Cr)', 'cyberSpend'],
  ['Cloud Maturity',     'cloudMaturity'],
  ['AI Readiness',       'aiReadiness'],
  ['Cyber Maturity',     'cyberMaturity'],
  ['Digital Maturity',   'digitalMaturity'],
  ['Pain Points',        'painPoints'],
  ['Buying Potential (₹ Cr/yr)', 'buyingPotential'],
  ['Website',            'website'],
];

/** Build a plain 2D array (header row + data rows) from records. */
export function recordsToRows(records, columns = EXPORT_COLUMNS) {
  const header = columns.map(c => c[0]);
  const rows = records.map(r => columns.map(c => {
    const val = r[c[1]];
    return val == null ? '' : val;
  }));
  return [header, ...rows];
}

/** CSV-escape a single cell value. */
function csvCell(val) {
  const s = String(val ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Convert a 2D array to a CSV string. */
export function rowsToCSV(rows) {
  return rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}

/** Trigger a browser download for a Blob. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Timestamped filename: "prefix_2026-07-17_1420.ext" */
export function timestampedName(prefix, ext) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `${prefix}_${stamp}.${ext}`;
}

export function fmtCurrency(n) {
  if (n == null) return '—';
  if (n >= 100000) return '₹' + (n / 100000).toFixed(2) + 'L Cr';
  if (n >= 1000)   return '₹' + (n / 1000).toFixed(2) + 'K Cr';
  return '₹' + n.toFixed(1) + ' Cr';
}
