/**
 * excel.js — SheetJS-based Excel file loader.
 *
 * Fetches .xlsx files, reads all sheets via SheetJS (XLSX),
 * emits progress events, returns raw sheet data as JSON arrays.
 *
 * SheetJS is loaded from CDN on first use (no build step).
 * Supports multiple files and sheet-level progress tracking.
 *
 * Usage:
 *   import { loadExcelFiles } from './excel.js';
 *   const sheets = await loadExcelFiles([
 *     'data/BFSI_Master_Database.xlsx',
 *     'data/ESDS_BFSI_MASTER_ALL_CATEGORIES_v3.xlsx',
 *   ], onProgress);
 */

import { bus } from '../utils/eventBus.js';

const SHEETJS_CDN = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';

let _XLSX = null;

async function ensureSheetJS() {
  if (_XLSX) return _XLSX;
  if (window.XLSX) { _XLSX = window.XLSX; return _XLSX; }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SHEETJS_CDN;
    script.onload = () => { _XLSX = window.XLSX; resolve(_XLSX); };
    script.onerror = () => reject(new Error('Failed to load SheetJS from CDN'));
    document.head.appendChild(script);
  });
}

/**
 * Fetch a single .xlsx file as ArrayBuffer with progress.
 */
async function fetchWithProgress(url, onProgress) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} loading ${url}`);

  const total = parseInt(resp.headers.get('Content-Length') || '0', 10);
  const reader = resp.body?.getReader();

  if (!reader || !total) {
    const buf = await resp.arrayBuffer();
    onProgress?.({ loaded: buf.byteLength, total: buf.byteLength, file: url });
    return buf;
  }

  const chunks = [];
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress?.({ loaded, total, file: url });
  }

  const merged = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged.buffer;
}

/**
 * Parse a workbook ArrayBuffer and return an array of
 * { sheetName, headers, rows } objects. Skips README/metadata sheets.
 */
function parseWorkbook(buffer, fileName) {
  const XLSX = _XLSX;
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true, cellText: true });

  // Sheets whose contents are metadata/documentation — skip entirely
  const SKIP_SHEETS = [
    'readme', 'notes', 'metadata', 'index', 'changelog',
    'field dictionary', 'verification log',
    'cooperative banking summary', // aggregate-only summary
  ];

  // Sheets that look like branch listings (25K+ rows). These are routed
  // separately by data.js — we tag them with kind='branches' so the
  // main pipeline can filter them out and the branch aggregator picks
  // them up.
  const BRANCH_PATTERN = /branches?\s*(part|list)?/i;

  const results = [];
  for (const sheetName of wb.SheetNames) {
    const norm = sheetName.toLowerCase().trim();
    if (SKIP_SHEETS.includes(norm)) continue;

    const ws = wb.Sheets[sheetName];
    const jsonRows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });

    if (jsonRows.length === 0) continue;

    const headers = Object.keys(jsonRows[0]);
    const kind = BRANCH_PATTERN.test(norm) ? 'branches' : 'entity';

    results.push({
      sheetName,
      fileName,
      headers,
      rows: jsonRows,
      rowCount: jsonRows.length,
      kind,
    });
  }

  return results;
}

/**
 * Load one or more Excel files, parse all sheets, return unified
 * sheet-data array. Emits 'data:progress' events via the bus.
 *
 * @param {string[]} urls   File paths relative to project root.
 * @param {Function} [onProgress] Optional callback({ phase, detail }).
 * @returns {Promise<Array<{sheetName, fileName, headers, rows, rowCount}>>}
 */
export async function loadExcelFiles(urls, onProgress) {
  const progress = (phase, detail) => {
    const payload = { phase, ...detail };
    bus.emit('data:progress', payload);
    onProgress?.(payload);
  };

  progress('init', { message: 'Loading SheetJS library…' });
  await ensureSheetJS();
  progress('init', { message: 'SheetJS ready.' });

  const allSheets = [];

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const fileName = url.split('/').pop();

    progress('fetch', {
      message: `Fetching ${fileName}…`,
      fileIndex: i,
      fileCount: urls.length,
    });

    const buffer = await fetchWithProgress(url, ({ loaded, total }) => {
      progress('fetch', {
        message: `Downloading ${fileName}…`,
        fileIndex: i,
        fileCount: urls.length,
        loaded,
        total,
        pct: total ? Math.round((loaded / total) * 100) : 0,
      });
    });

    progress('parse', {
      message: `Parsing ${fileName}…`,
      fileIndex: i,
      fileCount: urls.length,
    });

    const sheets = parseWorkbook(buffer, fileName);
    allSheets.push(...sheets);

    const totalRows = sheets.reduce((s, sh) => s + sh.rowCount, 0);

    progress('parse', {
      message: `Parsed ${fileName}: ${sheets.length} sheets, ${totalRows} rows.`,
      fileIndex: i,
      fileCount: urls.length,
      sheetsLoaded: sheets.length,
      rowsLoaded: totalRows,
    });
  }

  const grandTotal = allSheets.reduce((s, sh) => s + sh.rowCount, 0);
  progress('done', {
    message: `All files loaded: ${allSheets.length} sheets, ${grandTotal} rows total.`,
    totalSheets: allSheets.length,
    totalRows: grandTotal,
  });

  return allSheets;
}
