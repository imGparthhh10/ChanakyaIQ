// Node port of assets/js/data/karnataka.js — row-parsing logic copied 1:1
// (bankRecord/societyRecord/extractCity/profitColor, sheet-index/row-offset
// constants), only the I/O (fetch+SheetJS-in-browser -> XLSX.readFile) swapped.
import { normalizeForDedup } from '../../utils/dedupeKey';
import { readAOA } from './excelReader';

const CAT_SCHEDULED = 'Scheduled State Co-operative Bank';
const CAT_NON_SCHEDULED = 'Non-Scheduled Urban Co-operative Bank';
const CAT_MULTI_STATE = 'Multi-State Co-operative Society';

function profitColor(np: number | null) {
  if (np == null) return '#64748B';
  if (np > 100) return '#16A34A';
  if (np >= 10) return '#EAB308';
  return '#DC2626';
}

function cleanCell(v: any): string {
  if (v == null) return '';
  const s = String(v).trim();
  if (!s || /^n\/?\.?a$/i.test(s) || s === '-' || s === '—') return '';
  return s;
}

function parseNetProfit(v: any): number | null {
  const s = cleanCell(v);
  if (!s) return null;
  const m = s.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

function stripLabel(v: any): string {
  const s = cleanCell(v);
  if (!s) return '';
  return s.replace(/^(contact person|mobile|email|full address|address)\s*:\s*/i, '').trim();
}

const KARNATAKA_CITIES = [
  'Bengaluru', 'Bangalore', 'Mysuru', 'Mysore', 'Hubli', 'Dharwad', 'Mangaluru', 'Mangalore',
  'Belagavi', 'Belgaum', 'Kalaburagi', 'Gulbarga', 'Davangere', 'Ballari', 'Bellary',
  'Vijayapura', 'Bijapur', 'Shivamogga', 'Shimoga', 'Tumakuru', 'Tumkur', 'Raichur',
  'Bidar', 'Hassan', 'Udupi', 'Hospet', 'Gadag', 'Chitradurga', 'Kolar', 'Mandya',
  'Chikmagalur', 'Chikkamagaluru', 'Karwar', 'Bagalkot', 'Koppal', 'Yadgir', 'Haveri',
  'Chamarajanagar', 'Ramanagara', 'Chikballapur', 'Kodagu', 'Madikeri',
];

function extractCity(address: string, roName: string): string {
  const hay = (address || '').toLowerCase();
  for (const c of KARNATAKA_CITIES) {
    if (hay.includes(c.toLowerCase())) return c;
  }
  const ro = cleanCell(roName);
  if (ro && !/^karnataka$/i.test(ro)) {
    if (/bangl?ore|bengaluru/i.test(ro)) return 'Bengaluru';
    return ro.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return '';
}

function bankRecord(cols: any[], category: string): any {
  const name = cleanCell(cols[1]);
  if (!name || name.length < 2) return null;
  const np = parseNetProfit(cols[8]);
  const address = cleanCell(cols[3]);
  const roName = cleanCell(cols[2]);
  const rec: any = {
    companyName: name,
    category,
    state: 'Karnataka',
    region: 'South',
    roName,
    hqAddress: address,
    hqCity: extractCity(address, roName),
    pincode: cleanCell(cols[4]),
    ceo: cleanCell(cols[5]),
    president: cleanCell(cols[6]),
    vicePresident: cleanCell(cols[7]),
    netProfit: np,
    itSpend: parseNetProfit(cols[9]),
    listedStatus: 'Unlisted',
    _source: 'MASTER_DATABASE_KARNATAKA.xlsx',
    isKarnataka: true,
    markerColor: profitColor(np),
  };
  rec._dedupeKey = normalizeForDedup(name);
  return rec;
}

function societyRecord(cols: any[]): any {
  const name = cleanCell(cols[1]);
  if (!name || name.length < 2) return null;
  const np = parseNetProfit(cols[11]);
  const address = stripLabel(cols[7]);
  const rec: any = {
    companyName: name,
    category: CAT_MULTI_STATE,
    subSector: cleanCell(cols[2]),
    sector: cleanCell(cols[2]),
    areaOfOperations: cleanCell(cols[3]),
    contactPerson: stripLabel(cols[4]),
    contactMobile: stripLabel(cols[5]),
    contactEmail: stripLabel(cols[6]),
    hqAddress: address,
    state: 'Karnataka',
    region: 'South',
    hqCity: extractCity(address, ''),
    ceo: cleanCell(cols[8]),
    president: cleanCell(cols[9]),
    vicePresident: cleanCell(cols[10]),
    netProfit: np,
    itSpend: parseNetProfit(cols[12]),
    listedStatus: 'Unlisted',
    _source: 'MASTER_DATABASE_KARNATAKA.xlsx',
    isKarnataka: true,
    markerColor: profitColor(np),
  };
  rec._dedupeKey = normalizeForDedup(name);
  return rec;
}

export function loadKarnataka(filePath: string) {
  const records: any[] = [];

  const s0 = readAOA(filePath, 0);
  for (let i = 2; i < s0.length; i++) {
    const rec = bankRecord(s0[i], CAT_SCHEDULED);
    if (rec) records.push(rec);
  }

  const s1 = readAOA(filePath, 1);
  for (let i = 2; i < s1.length; i++) {
    const rec = bankRecord(s1[i], CAT_NON_SCHEDULED);
    if (rec) records.push(rec);
  }

  const s2 = readAOA(filePath, 2);
  for (let i = 1; i < s2.length; i++) {
    const rec = societyRecord(s2[i]);
    if (rec) records.push(rec);
  }

  const byKey = new Map<string, any>();
  for (const rec of records) {
    if (!byKey.has(rec._dedupeKey)) {
      byKey.set(rec._dedupeKey, rec);
      continue;
    }
    const keep = byKey.get(rec._dedupeKey);
    for (const [k, v] of Object.entries(rec)) {
      if ((keep[k] == null || keep[k] === '') && v != null && v !== '') keep[k] = v;
    }
  }
  const uniqueRecords = [...byKey.values()];

  const s3 = readAOA(filePath, 3);
  const branches: any[] = [];
  const apex = uniqueRecords.find((r) => /apex\s+bank/i.test(r.companyName));
  const apexKey = apex ? apex._dedupeKey : normalizeForDedup('The Karnataka State Co-operative Apex Bank Ltd.');

  let brCounter = 0;
  const cityCount: Record<string, number> = {};
  for (let i = 2; i < s3.length; i++) {
    const cols = s3[i];
    const branchName = cleanCell(cols[1]);
    if (!branchName) continue;
    const address = cleanCell(cols[2]);
    const city = extractCity(address, '');
    if (city) cityCount[city] = (cityCount[city] || 0) + 1;
    branches.push({
      id: `kbr_${++brCounter}`,
      parentName: apex ? apex.companyName : 'The Karnataka State Co-operative Apex Bank Ltd.',
      parentKey: apexKey,
      branchName,
      ifsc: cleanCell(cols[6]),
      address,
      city,
      district: '',
      state: 'Karnataka',
      region: 'South',
      telephone: cleanCell(cols[3]),
      managerName: cleanCell(cols[4]),
      mobile: cleanCell(cols[5]),
      ceo: cleanCell(cols[7]),
      president: cleanCell(cols[8]),
      vicePresident: cleanCell(cols[9]),
      category: CAT_SCHEDULED,
      subSector: 'Scheduled State Co-operative Bank',
      ownership: 'Co-operative',
      source: 'MASTER_DATABASE_KARNATAKA.xlsx',
    });
  }

  if (apex && branches.length) {
    apex.branchTotal = branches.length;
    apex.branchCount = apex.branchCount || branches.length;
    apex.branchesByState = { Karnataka: branches.length };
    apex.branchesByRegion = { South: branches.length };
    apex.topBranchCities = Object.entries(cityCount).sort((a, b) => b[1] - a[1]).slice(0, 10);
    apex.topBranchDistricts = [];
    apex.ifscSample = branches.map((b) => b.ifsc).filter(Boolean).slice(0, 5);
  }

  return {
    records: uniqueRecords,
    branches,
    stats: {
      scheduled: records.filter((r) => r.category === CAT_SCHEDULED).length,
      nonScheduled: records.filter((r) => r.category === CAT_NON_SCHEDULED).length,
      multiState: records.filter((r) => r.category === CAT_MULTI_STATE).length,
      uniqueCompanies: uniqueRecords.length,
      apexBranches: branches.length,
    },
  };
}
