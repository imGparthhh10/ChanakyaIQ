// Node-native replacement for assets/js/data/excel.js. Same parsing rules
// (SKIP_SHEETS, BRANCH_PATTERN, sheet_to_json shape) so parser.js/branches.js
// (imported unmodified) see identical input to what they get in the browser
// — only the I/O (fetch+CDN vs XLSX.readFile) differs.
import * as XLSX from 'xlsx';

export interface RawSheet {
  sheetName: string;
  fileName: string;
  headers: string[];
  rows: Record<string, any>[];
  rowCount: number;
  kind: 'entity' | 'branches';
}

const SKIP_SHEETS = [
  'readme', 'notes', 'metadata', 'index', 'changelog',
  'field dictionary', 'verification log',
  'cooperative banking summary',
];

const BRANCH_PATTERN = /branches?\s*(part|list)?/i;

export function readWorkbook(filePath: string, fileName: string): RawSheet[] {
  const wb = XLSX.readFile(filePath, { cellDates: true, cellText: true });
  const results: RawSheet[] = [];

  for (const sheetName of wb.SheetNames) {
    const norm = sheetName.toLowerCase().trim();
    if (SKIP_SHEETS.includes(norm)) continue;

    const ws = wb.Sheets[sheetName];
    const jsonRows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '', raw: false });
    if (jsonRows.length === 0) continue;

    const headers = Object.keys(jsonRows[0]);
    const kind: RawSheet['kind'] = BRANCH_PATTERN.test(norm) ? 'branches' : 'entity';

    results.push({ sheetName, fileName, headers, rows: jsonRows, rowCount: jsonRows.length, kind });
  }

  return results;
}

/** Raw array-of-arrays reader, for the Karnataka/Gujarat dedicated loaders. */
export function readAOA(filePath: string, sheetIndex: number): any[][] {
  const wb = XLSX.readFile(filePath, { cellText: true });
  const name = wb.SheetNames[sheetIndex];
  if (!name) return [];
  return XLSX.utils.sheet_to_json<any[]>(wb.Sheets[name], { header: 1, defval: '' });
}
