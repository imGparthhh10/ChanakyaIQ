// Node port of assets/js/data/gujarat.js — row-parsing logic copied 1:1,
// only the I/O swapped (fetch+SheetJS-in-browser -> XLSX.readFile).
import { normalizeForDedup } from '../../utils/dedupeKey';
import { readAOA } from './excelReader';

const CAT_STATE = 'Scheduled State Co-operative Bank';
const CAT_NON_SCHEDULED = 'Non-Scheduled Urban Co-operative Bank';
const CAT_DCCB = 'District Central Co-operative Bank';
const CAT_MULTI_STATE = 'Multi-State Co-operative Society';

function itSpendColor(cr: number | null) {
  if (cr == null) return '#64748B';
  if (cr >= 1) return '#16A34A';
  if (cr >= 0.1) return '#EAB308';
  return '#DC2626';
}

function cleanCell(v: any): string {
  if (v == null) return '';
  const s = String(v).trim();
  if (!s || /^n\/?\.?a$/i.test(s) || s === '-' || s === '—') return '';
  return s;
}

function parseItSpend(v: any): { raw: string; cr: number | null } {
  const s = cleanCell(v);
  if (!s) return { raw: '', cr: null };
  const m = s.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  if (!m) return { raw: s, cr: null };
  const num = parseFloat(m[0]);
  const cr = /\bl\b|lakh|lac/i.test(s) ? num / 100 : num;
  return { raw: s, cr };
}

const GUJARAT_CITY_ALIASES: Record<string, string> = {
  ahmedabad: 'Ahmedabad', ahmadabad: 'Ahmedabad',
  surat: 'Surat', vadodara: 'Vadodara', baroda: 'Vadodara',
  rajkot: 'Rajkot', bhavnagar: 'Bhavnagar', jamnagar: 'Jamnagar',
  gandhinagar: 'Gandhinagar', anand: 'Anand', bharuch: 'Bharuch',
  mahesana: 'Mehsana', mehsana: 'Mehsana', junagadh: 'Junagadh',
  morbi: 'Morbi', bhuj: 'Bhuj', kutch: 'Bhuj', kachchh: 'Bhuj',
  nadiad: 'Nadiad', kheda: 'Nadiad', palanpur: 'Palanpur',
  banaskantha: 'Palanpur', valsad: 'Valsad', navsari: 'Navsari',
  amreli: 'Amreli', patan: 'Patan', godhra: 'Godhra',
  panchmahal: 'Godhra', porbandar: 'Porbandar', botad: 'Botad',
  surendranagar: 'Surendranagar', vapi: 'Vapi',
};

function fuzzyKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/^\s*the\s+/, '')
    .replace(/\bco[\s.-]*op(erative)?\b/g, 'coop')
    .replace(/\bltd\.?\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function extractCity(address: string, roName: string): string {
  const hay = (address || '').toLowerCase();
  for (const [key, canon] of Object.entries(GUJARAT_CITY_ALIASES)) {
    if (hay.includes(key)) return canon;
  }
  const ro = cleanCell(roName).toLowerCase().replace(/[^a-z]/g, '');
  if (ro && GUJARAT_CITY_ALIASES[ro]) return GUJARAT_CITY_ALIASES[ro];
  return '';
}

function bankRecord(cols: any[], category: string): any {
  let name = cleanCell(cols[1]);
  if (!name || name.length < 2) return null;
  if (category === CAT_STATE && /^gujarat state co.?operative bank/i.test(name)) {
    name = 'The Gujarat State Co-operative Bank Ltd.';
  }
  const address = cleanCell(cols[3]);
  const roName = cleanCell(cols[2]);
  const it = parseItSpend(cols[7]);
  const rec: any = {
    companyName: name,
    category,
    subSector: category,
    state: 'Gujarat',
    region: 'West',
    roName,
    hqAddress: address,
    hqCity: extractCity(address, roName),
    pincode: cleanCell(cols[4]),
    chairman: cleanCell(cols[5]),
    ceo: cleanCell(cols[6]),
    itSpend: it.cr,
    itSpendRaw: it.raw,
    listedStatus: 'Unlisted',
    ownership: 'Co-operative',
    _source: 'MASTER_DATABASE_GUJARAT.xlsx',
    isGujarat: true,
    markerColor: itSpendColor(it.cr),
  };
  rec._dedupeKey = normalizeForDedup(name);
  return rec;
}

function societyRecord(cols: any[]): any {
  const name = cleanCell(cols[1]);
  if (!name || name.length < 2) return null;
  const address = cleanCell(cols[5]);
  const roName = cleanCell(cols[2]);
  const it = parseItSpend(cols[9]);
  const rec: any = {
    companyName: name,
    category: CAT_MULTI_STATE,
    subSector: cleanCell(cols[3]) || CAT_MULTI_STATE,
    sector: cleanCell(cols[3]),
    areaOfOperations: cleanCell(cols[4]),
    contactPerson: cleanCell(cols[6]),
    contactMobile: cleanCell(cols[7]),
    contactEmail: cleanCell(cols[8]),
    hqAddress: address,
    state: 'Gujarat',
    region: 'West',
    roName,
    hqCity: extractCity(address, roName),
    itSpend: it.cr,
    itSpendRaw: it.raw,
    listedStatus: 'Unlisted',
    ownership: 'Co-operative',
    _source: 'MASTER_DATABASE_GUJARAT.xlsx',
    isGujarat: true,
    markerColor: itSpendColor(it.cr),
  };
  rec._dedupeKey = normalizeForDedup(name);
  return rec;
}

export function loadGujarat(filePath: string) {
  const records: any[] = [];

  const s0 = readAOA(filePath, 0);
  for (let i = 1; i < s0.length; i++) {
    const rec = bankRecord(s0[i], CAT_STATE);
    if (rec) records.push(rec);
  }

  const s1 = readAOA(filePath, 1);
  for (let i = 2; i < s1.length; i++) {
    const rec = bankRecord(s1[i], CAT_NON_SCHEDULED);
    if (rec) records.push(rec);
  }

  const s2 = readAOA(filePath, 2);
  for (let i = 2; i < s2.length; i++) {
    const rec = bankRecord(s2[i], CAT_DCCB);
    if (rec) records.push(rec);
  }

  const s3 = readAOA(filePath, 3);
  for (let i = 1; i < s3.length; i++) {
    const rec = societyRecord(s3[i]);
    if (rec) records.push(rec);
  }

  const byKey = new Map<string, any>();
  for (const rec of records) {
    const key = fuzzyKey(rec.companyName);
    if (!byKey.has(key)) {
      byKey.set(key, rec);
      continue;
    }
    const keep = byKey.get(key);
    for (const [k, v] of Object.entries(rec)) {
      if ((keep[k] == null || keep[k] === '') && v != null && v !== '') keep[k] = v;
    }
  }
  const uniqueRecords = [...byKey.values()];

  return {
    records: uniqueRecords,
    branches: [] as any[],
    stats: {
      stateCoopBank: records.filter((r) => r.category === CAT_STATE).length,
      urbanCoopBanks: records.filter((r) => r.category === CAT_NON_SCHEDULED).length,
      dccb: records.filter((r) => r.category === CAT_DCCB).length,
      multiState: records.filter((r) => r.category === CAT_MULTI_STATE).length,
      uniqueCompanies: uniqueRecords.length,
    },
  };
}
