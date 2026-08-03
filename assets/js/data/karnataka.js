/**
 * karnataka.js — Dedicated loader for the Karnataka Corporate Banking
 * master workbook (MASTER_DATABASE_KARNATAKA.xlsx).
 *
 * This workbook has a different shape from the generic BFSI masters, so it
 * gets its own parser instead of forcing it through the generic column
 * detector. It produces:
 *   - `records`  : pre-validated canonical company objects (ready for cache)
 *   - `branches` : flat branch objects for the Apex Bank (map + Company 360)
 *
 * Sheets (by index — the workbook's tab names contain stray commas/spaces):
 *   0  Scheduled State Co-operative Banks     (header row 2)
 *   1  Non-Scheduled Urban Co-operative Banks (header row 2)
 *   2  Multi-State Co-operative Societies      (header row 1, "Label: value")
 *   3  APEX — branches of ONE parent company   (header row 2)
 *
 * STRICT RULE: nothing is invented. Missing cells become null/'' and the UI
 * shows "N/A". No dummy values, no fabricated fields.
 */

import { normalizeForDedup } from './validator.js';

const KARNATAKA_FILE = 'data/MASTER_DATABASE_KARNATAKA.xlsx';

// Category label per sheet (drives the existing Category filter)
const CAT_SCHEDULED     = 'Scheduled State Co-operative Bank';
const CAT_NON_SCHEDULED = 'Non-Scheduled Urban Co-operative Bank';
const CAT_MULTI_STATE   = 'Multi-State Co-operative Society';

// Net-profit → marker colour (per spec)
function profitColor(np) {
  if (np == null) return '#64748B';   // gray — unavailable
  if (np > 100)   return '#16A34A';   // green
  if (np >= 10)   return '#EAB308';   // yellow
  return '#DC2626';                    // red
}

// ─── Value parsers (defensive; never fabricate) ───

function cleanCell(v) {
  if (v == null) return '';
  const s = String(v).trim();
  if (!s || /^n\/?\.?a$/i.test(s) || s === '-' || s === '—') return '';
  return s;
}

/** "75  CR" → 75 ; "N/A" → null ; "1,234.5 Cr" → 1234.5 */
function parseNetProfit(v) {
  const s = cleanCell(v);
  if (!s) return null;
  const m = s.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

/** Strip a leading "Label: " prefix (Sheet 3 values). */
function stripLabel(v) {
  const s = cleanCell(v);
  if (!s) return '';
  return s.replace(/^(contact person|mobile|email|full address|address)\s*:\s*/i, '').trim();
}

/** Best-effort city extraction from a Head-Office address for geocoding. */
const KARNATAKA_CITIES = [
  'Bengaluru', 'Bangalore', 'Mysuru', 'Mysore', 'Hubli', 'Dharwad', 'Mangaluru', 'Mangalore',
  'Belagavi', 'Belgaum', 'Kalaburagi', 'Gulbarga', 'Davangere', 'Ballari', 'Bellary',
  'Vijayapura', 'Bijapur', 'Shivamogga', 'Shimoga', 'Tumakuru', 'Tumkur', 'Raichur',
  'Bidar', 'Hassan', 'Udupi', 'Hospet', 'Gadag', 'Chitradurga', 'Kolar', 'Mandya',
  'Chikmagalur', 'Chikkamagaluru', 'Karwar', 'Bagalkot', 'Koppal', 'Yadgir', 'Haveri',
  'Chamarajanagar', 'Ramanagara', 'Chikballapur', 'Kodagu', 'Madikeri',
];

function extractCity(address, roName) {
  const hay = (address || '').toLowerCase();
  for (const c of KARNATAKA_CITIES) {
    if (hay.includes(c.toLowerCase())) return c;
  }
  // RO Name sometimes carries a city ("BANGLORE" misspelling etc.)
  const ro = cleanCell(roName);
  if (ro && !/^karnataka$/i.test(ro)) {
    if (/bangl?ore|bengaluru/i.test(ro)) return 'Bengaluru';
    return ro.replace(/\b\w/g, c => c.toUpperCase());
  }
  return ''; // getCoords falls back to Karnataka capital / centroid
}

// ─── Sheet readers (array-of-arrays) ───

function readAOA(XLSX, wb, index) {
  const name = wb.SheetNames[index];
  if (!name) return [];
  return XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
}

/** Build a company record from a co-op-bank row (Sheets 0 & 1). */
function bankRecord(cols, category) {
  const name = cleanCell(cols[1]);       // Bank Name
  if (!name || name.length < 2) return null;
  const np = parseNetProfit(cols[8]);    // NET PROFIT- CR
  const address = cleanCell(cols[3]);    // Head Office Address
  const roName  = cleanCell(cols[2]);    // RO Name
  const rec = {
    companyName:     name,
    category,
    state:           'Karnataka',
    region:          'South',
    roName,
    hqAddress:       address,
    hqCity:          extractCity(address, roName),
    pincode:         cleanCell(cols[4]),
    ceo:             cleanCell(cols[5]),
    president:       cleanCell(cols[6]),
    vicePresident:   cleanCell(cols[7]),
    netProfit:       np,
    itSpend:         parseNetProfit(cols[9]),  // IT expenditure (usually N/A)
    listedStatus:    'Unlisted',
    _source:         'MASTER_DATABASE_KARNATAKA.xlsx',
    isKarnataka:     true,
    markerColor:     profitColor(np),
  };
  rec._dedupeKey = normalizeForDedup(name);
  return rec;
}

/** Build a company record from a multi-state society row (Sheet 2). */
function societyRecord(cols) {
  const name = cleanCell(cols[1]);       // Society Name
  if (!name || name.length < 2) return null;
  const np = parseNetProfit(cols[11]);
  const address = stripLabel(cols[7]);   // Full Address
  const rec = {
    companyName:       name,
    category:          CAT_MULTI_STATE,
    subSector:         cleanCell(cols[2]),          // Sector
    sector:            cleanCell(cols[2]),
    areaOfOperations:  cleanCell(cols[3]),
    contactPerson:     stripLabel(cols[4]),
    contactMobile:     stripLabel(cols[5]),
    contactEmail:      stripLabel(cols[6]),
    hqAddress:         address,
    state:             'Karnataka',
    region:            'South',
    hqCity:            extractCity(address, ''),
    ceo:               cleanCell(cols[8]),
    president:         cleanCell(cols[9]),
    vicePresident:     cleanCell(cols[10]),
    netProfit:         np,
    itSpend:           parseNetProfit(cols[12]),
    listedStatus:      'Unlisted',
    _source:           'MASTER_DATABASE_KARNATAKA.xlsx',
    isKarnataka:       true,
    markerColor:       profitColor(np),
  };
  rec._dedupeKey = normalizeForDedup(name);
  return rec;
}

// ─── Public loader ───

/**
 * @param {Object} XLSX  the SheetJS namespace (already loaded by excel.js)
 * @returns {Promise<{records:Object[], branches:Object[], stats:Object}>}
 */
export async function loadKarnataka(XLSX) {
  const resp = await fetch(KARNATAKA_FILE);
  if (!resp.ok) throw new Error(`Karnataka file HTTP ${resp.status}`);
  const buf = await resp.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellText: true });

  const records = [];

  // Sheet 0 — Scheduled State Co-operative Banks (data from row index 2)
  const s0 = readAOA(XLSX, wb, 0);
  for (let i = 2; i < s0.length; i++) {
    const rec = bankRecord(s0[i], CAT_SCHEDULED);
    if (rec) records.push(rec);
  }

  // Sheet 1 — Non-Scheduled Urban Co-operative Banks (data from row index 2)
  const s1 = readAOA(XLSX, wb, 1);
  for (let i = 2; i < s1.length; i++) {
    const rec = bankRecord(s1[i], CAT_NON_SCHEDULED);
    if (rec) records.push(rec);
  }

  // Sheet 2 — Multi-State Co-operative Societies (data from row index 1)
  const s2 = readAOA(XLSX, wb, 2);
  for (let i = 1; i < s2.length; i++) {
    const rec = societyRecord(s2[i]);
    if (rec) records.push(rec);
  }

  // Deduplicate within Karnataka (Apex appears in Sheet 0; keep the richest)
  const byKey = new Map();
  for (const rec of records) {
    if (!byKey.has(rec._dedupeKey)) { byKey.set(rec._dedupeKey, rec); continue; }
    // merge: fill blanks from the duplicate
    const keep = byKey.get(rec._dedupeKey);
    for (const [k, v] of Object.entries(rec)) {
      if ((keep[k] == null || keep[k] === '') && v != null && v !== '') keep[k] = v;
    }
  }
  const uniqueRecords = [...byKey.values()];

  // Sheet 3 — APEX branches (one parent: the Apex Bank)
  const s3 = readAOA(XLSX, wb, 3);
  const branches = [];
  const apex = uniqueRecords.find(r => /apex\s+bank/i.test(r.companyName));
  const apexKey = apex ? apex._dedupeKey : normalizeForDedup('The Karnataka State Co-operative Apex Bank Ltd.');

  let brCounter = 0;
  const cityCount = {};
  for (let i = 2; i < s3.length; i++) {
    const cols = s3[i];
    const branchName = cleanCell(cols[1]);
    if (!branchName) continue;
    const address = cleanCell(cols[2]);
    const city = extractCity(address, '');
    if (city) cityCount[city] = (cityCount[city] || 0) + 1;
    branches.push({
      id:          `kbr_${++brCounter}`,
      parentName:  apex ? apex.companyName : 'The Karnataka State Co-operative Apex Bank Ltd.',
      parentKey:   apexKey,
      branchName,
      ifsc:        cleanCell(cols[6]),
      address,
      city,
      district:    '',
      state:       'Karnataka',
      region:      'South',
      telephone:   cleanCell(cols[3]),
      managerName: cleanCell(cols[4]),
      mobile:      cleanCell(cols[5]),
      ceo:         cleanCell(cols[7]),
      president:   cleanCell(cols[8]),
      vicePresident: cleanCell(cols[9]),
      hqLocation:  '',
      website:     '',
      category:    CAT_SCHEDULED,
      subSector:   'Scheduled State Co-operative Bank',
      ownership:   'Co-operative',
      source:      'MASTER_DATABASE_KARNATAKA.xlsx',
    });
  }

  // Attach a branch profile to the Apex company record
  if (apex && branches.length) {
    apex.branchTotal        = branches.length;
    apex.branchCount        = apex.branchCount || branches.length;
    apex.branchesByState    = { Karnataka: branches.length };
    apex.branchesByRegion   = { South: branches.length };
    apex.topBranchCities    = Object.entries(cityCount).sort((a, b) => b[1] - a[1]).slice(0, 10);
    apex.topBranchDistricts = [];
    apex.ifscSample         = branches.map(b => b.ifsc).filter(Boolean).slice(0, 5);
  }

  return {
    records: uniqueRecords,
    branches,
    stats: {
      scheduled:     records.filter(r => r.category === CAT_SCHEDULED).length,
      nonScheduled:  records.filter(r => r.category === CAT_NON_SCHEDULED).length,
      multiState:    records.filter(r => r.category === CAT_MULTI_STATE).length,
      uniqueCompanies: uniqueRecords.length,
      apexBranches:  branches.length,
    },
  };
}
