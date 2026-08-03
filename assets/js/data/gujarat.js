/**
 * gujarat.js — Dedicated loader for the Gujarat Co-operative Banking
 * master workbook (MASTER_DATABASE_GUJARAT.xlsx).
 *
 * Different shape from the generic BFSI masters (and from Karnataka's),
 * so it gets its own parser instead of forcing it through the generic
 * column detector. Produces pre-validated canonical company records
 * (ready for cache) — this workbook has NO branch-level sheet, so no
 * branches array is produced (nothing to nest — nothing invented).
 *
 * Sheets (by index — verified via raw XML inspection, not the prompt):
 *   0  State Coop Bank      — header row 0, data row 1   (Gujarat State Co-op Bank — 1 record)
 *   1  Urban Coop Banks     — title row 0, header row 1, data row 2+
 *   2  DCCB                 — title row 0, header row 1, data row 2+
 *   3  Multi State Coop     — header row 0, data row 1+
 *
 * STRICT RULE: nothing is invented. Missing cells become null/'' and the UI
 * shows "N/A" for every leadership/IT-spend field. No dummy values.
 */

import { normalizeForDedup } from './validator.js';

const GUJARAT_FILE = 'data/MASTER_DATABASE_GUJARAT.xlsx';

// Category labels reuse the same strings as karnataka.js where the
// institution type matches, so the Category filter doesn't fragment.
const CAT_STATE         = 'Scheduled State Co-operative Bank';
const CAT_NON_SCHEDULED = 'Non-Scheduled Urban Co-operative Bank';
const CAT_DCCB          = 'District Central Co-operative Bank';
const CAT_MULTI_STATE   = 'Multi-State Co-operative Society';

// ─── IT Spend / Cyber Security Fund → marker colour ───
// The prompt left thresholds unspecified. Determined from the real data
// distribution (33 non-N/A values spanning ₹2L–₹9Cr): a roughly even
// three-way split lands at ≥₹1Cr green / ₹10L–99L yellow / <₹10L red,
// mirroring Karnataka's Net-Profit thresholds (>100/10-100/<10) one
// order of magnitude down, since IT spend here is naturally smaller
// than bank net profit.
function itSpendColor(cr) {
  if (cr == null) return '#64748B';   // gray — unavailable
  if (cr >= 1)    return '#16A34A';   // green — ₹1 Cr+
  if (cr >= 0.1)  return '#EAB308';   // yellow — ₹10L–99L
  return '#DC2626';                    // red — under ₹10L
}

// ─── Value parsers (defensive; never fabricate) ───

function cleanCell(v) {
  if (v == null) return '';
  const s = String(v).trim();
  if (!s || /^n\/?\.?a$/i.test(s) || s === '-' || s === '—') return '';
  return s;
}

/** "3.3 Cr" → {raw:"3.3 Cr", cr:3.3} ; "60 L" → {raw:"60 L", cr:0.6} ; "N/A" → {raw:'', cr:null} */
function parseItSpend(v) {
  const s = cleanCell(v);
  if (!s) return { raw: '', cr: null };
  const m = s.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  if (!m) return { raw: s, cr: null };
  const num = parseFloat(m[0]);
  const cr = /\bl\b|lakh|lac/i.test(s) ? num / 100 : num; // Lakh → Crore, else already Crore
  return { raw: s, cr };
}

/** Best-effort city extraction from a Head-Office address / RO name for geocoding. */
const GUJARAT_CITY_ALIASES = {
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

/**
 * Local, Gujarat-scoped fuzzy key for catching same-institution rows that
 * appear on more than one sheet with slightly different spelling — e.g.
 * "Co operative"/"Co-op"/"Cooperative" and a leading "The " (both occur
 * in this workbook: "Ahmedabad Mercantile Co-Op Bank Ltd" on the Urban
 * sheet vs "The Ahmedabad Mercantile Co-op. Bank Ltd." on the Multi-State
 * sheet). Used only to GROUP duplicates for merging within this file —
 * the record's real `_dedupeKey` (shared normalizeForDedup) is untouched.
 */
function fuzzyKey(name) {
  return name
    .toLowerCase()
    .replace(/^\s*the\s+/, '')
    .replace(/\bco[\s.-]*op(erative)?\b/g, 'coop')
    .replace(/\bltd\.?\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function extractCity(address, roName) {
  const hay = (address || '').toLowerCase();
  for (const [key, canon] of Object.entries(GUJARAT_CITY_ALIASES)) {
    if (hay.includes(key)) return canon;
  }
  const ro = cleanCell(roName).toLowerCase().replace(/[^a-z]/g, '');
  if (ro && GUJARAT_CITY_ALIASES[ro]) return GUJARAT_CITY_ALIASES[ro];
  return ''; // getCoords falls back to Gujarat centroid
}

// ─── Sheet readers (array-of-arrays) ───

function readAOA(XLSX, wb, index) {
  const name = wb.SheetNames[index];
  if (!name) return [];
  return XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
}

/** Build a company record from a co-op-bank row (Sheets 0, 1, 2). */
function bankRecord(cols, category) {
  let name = cleanCell(cols[1]);         // Bank Name
  if (!name || name.length < 2) return null;
  // The State Co-op Bank sheet has exactly one row: the apex parent company.
  // Align its name to the canonical form already used by the existing
  // generic Banking Master ("The Gujarat State Co-operative Bank Ltd.")
  // so the two converge into the single required Company 360 entry
  // instead of duplicating — same real institution, same shared
  // normalizeForDedup(), not a fabricated value.
  if (category === CAT_STATE && /^gujarat state co.?operative bank/i.test(name)) {
    name = 'The Gujarat State Co-operative Bank Ltd.';
  }
  const address = cleanCell(cols[3]);    // Head Office Address
  const roName  = cleanCell(cols[2]);    // RO Name
  const it = parseItSpend(cols[7]);      // IT Spend/Cyber Security Fund (absent on Sheet 0)
  const rec = {
    companyName:     name,
    category,
    subSector:       category,
    state:           'Gujarat',
    region:          'West',
    roName,
    hqAddress:       address,
    hqCity:          extractCity(address, roName),
    pincode:         cleanCell(cols[4]),
    chairman:        cleanCell(cols[5]),
    ceo:             cleanCell(cols[6]),
    itSpend:         it.cr,
    itSpendRaw:      it.raw,
    listedStatus:    'Unlisted',
    ownership:       'Co-operative',
    _source:         'MASTER_DATABASE_GUJARAT.xlsx',
    isGujarat:       true,
    markerColor:     itSpendColor(it.cr),
  };
  rec._dedupeKey = normalizeForDedup(name);
  return rec;
}

/** Build a company record from a multi-state society row (Sheet 3). */
function societyRecord(cols) {
  const name = cleanCell(cols[1]);       // Society Name
  if (!name || name.length < 2) return null;
  const address = cleanCell(cols[5]);    // Address
  const roName  = cleanCell(cols[2]);
  const it = parseItSpend(cols[9]);      // IT Spend/Cyber Security Fund
  const rec = {
    companyName:       name,
    category:          CAT_MULTI_STATE,
    subSector:          cleanCell(cols[3]) || CAT_MULTI_STATE, // Sector
    sector:             cleanCell(cols[3]),
    areaOfOperations:   cleanCell(cols[4]),
    contactPerson:      cleanCell(cols[6]),
    contactMobile:      cleanCell(cols[7]),
    contactEmail:       cleanCell(cols[8]),
    hqAddress:          address,
    state:              'Gujarat',
    region:             'West',
    roName,
    hqCity:             extractCity(address, roName),
    itSpend:            it.cr,
    itSpendRaw:         it.raw,
    listedStatus:       'Unlisted',
    ownership:          'Co-operative',
    _source:            'MASTER_DATABASE_GUJARAT.xlsx',
    isGujarat:          true,
    markerColor:        itSpendColor(it.cr),
  };
  rec._dedupeKey = normalizeForDedup(name);
  return rec;
}

// ─── Public loader ───

/**
 * @param {Object} XLSX  the SheetJS namespace (already loaded by excel.js)
 * @returns {Promise<{records:Object[], branches:Object[], stats:Object}>}
 */
export async function loadGujarat(XLSX) {
  const resp = await fetch(GUJARAT_FILE);
  if (!resp.ok) throw new Error(`Gujarat file HTTP ${resp.status}`);
  const buf = await resp.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellText: true });

  const records = [];

  // Sheet 0 — State Coop Bank (header row 0, data from row 1)
  const s0 = readAOA(XLSX, wb, 0);
  for (let i = 1; i < s0.length; i++) {
    const rec = bankRecord(s0[i], CAT_STATE);
    if (rec) records.push(rec);
  }

  // Sheet 1 — Urban Coop Banks (title row 0, header row 1, data from row 2)
  const s1 = readAOA(XLSX, wb, 1);
  for (let i = 2; i < s1.length; i++) {
    const rec = bankRecord(s1[i], CAT_NON_SCHEDULED);
    if (rec) records.push(rec);
  }

  // Sheet 2 — DCCB (title row 0, header row 1, data from row 2)
  const s2 = readAOA(XLSX, wb, 2);
  for (let i = 2; i < s2.length; i++) {
    const rec = bankRecord(s2[i], CAT_DCCB);
    if (rec) records.push(rec);
  }

  // Sheet 3 — Multi State Coop (header row 0, data from row 1)
  const s3 = readAOA(XLSX, wb, 3);
  for (let i = 1; i < s3.length; i++) {
    const rec = societyRecord(s3[i]);
    if (rec) records.push(rec);
  }

  // Deduplicate within Gujarat (merge fills blanks from duplicate rows).
  // Grouped by fuzzyKey — not the exact _dedupeKey — because the same
  // institution appears across sheets with spelling variants the exact
  // key won't catch (see fuzzyKey doc comment above).
  const byKey = new Map();
  for (const rec of records) {
    const key = fuzzyKey(rec.companyName);
    if (!byKey.has(key)) { byKey.set(key, rec); continue; }
    const keep = byKey.get(key);
    for (const [k, v] of Object.entries(rec)) {
      if ((keep[k] == null || keep[k] === '') && v != null && v !== '') keep[k] = v;
    }
  }
  const uniqueRecords = [...byKey.values()];

  return {
    records: uniqueRecords,
    branches: [], // this workbook has no branch-level sheet — nothing to nest
    stats: {
      stateCoopBank:  records.filter(r => r.category === CAT_STATE).length,
      urbanCoopBanks: records.filter(r => r.category === CAT_NON_SCHEDULED).length,
      dccb:           records.filter(r => r.category === CAT_DCCB).length,
      multiState:     records.filter(r => r.category === CAT_MULTI_STATE).length,
      uniqueCompanies: uniqueRecords.length,
    },
  };
}
