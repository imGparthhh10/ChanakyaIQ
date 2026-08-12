// Loads data/master_govt_finance_database *.xlsx (State/UT, Department/
// Organization, Parent Ministry, Sector, Department Type, Allocated Budget
// (Cr), IT/Digital/Technology Spend (Cr), Water/Power/Energy/Electricity/
// Education Budget (Cr), State IT Budget Allocation (Cr), Financial Year,
// Source Document, Source URL, Verification Status).
//
// Three things verified against the real file before writing this:
//   1. ~66 of 549 rows are state-level rollups ("Andhra Pradesh State Total
//      Budget (Aggregate)"), not individual departments -- excluded from
//      becoming organizations per the confirmed decision.
//   2. The 5 category budget columns (Water/Power/Energy/Electricity/
//      Education) are, on every real department row where populated,
//      IDENTICAL to that same row's own Allocated Budget (checked: 0
//      mismatches across 127 non-aggregate rows where a category column
//      had a value) -- so only Allocated Budget is imported; importing the
//      category columns too would store the same rupee figure twice under
//      two different metric keys.
//   3. IT/Digital/Technology Spend and State IT Budget Allocation are the
//      same fact restated in two columns (0 mismatches across the 20 rows
//      where both are populated) -- mapped to the single existing
//      `it_spend` metric, preferring the first column, falling back to the
//      second.
//
// Department names repeat across states ("School Education Department" x6,
// once per state) -- the shared dedupe index matches by normalized name
// globally, so the org's legal name is state-qualified here to keep each
// state's department a distinct entity instead of collapsing into one.
import { normalizeForDedup } from '../../utils/dedupeKey';
import { readWorkbook } from './excelReader';
import { cleanCell, normalizeStateName } from './textNormalize';

function parseNumberCr(raw: any): number | null {
  const s = cleanCell(raw);
  if (!s) return null;
  const n = parseFloat(s.replace(/,/g, ''));
  return Number.isNaN(n) ? null : n;
}

function parseFiscalYear(raw: any): number | null {
  const s = cleanCell(raw);
  const m = s.match(/^(\d{4})/);
  return m ? parseInt(m[1], 10) : null;
}

/** Verification Status has ~40 distinct free-text variants ("Verified
 *  (minor rounding discrepancy...)", "Not Yet Verified - Pending (...)")
 *  -- bucketed by prefix into financial_metrics.confidence rather than
 *  matched exhaustively, since the qualifier text is preserved verbatim in
 *  sourceCitation for anyone who needs the detail. */
function verificationConfidence(status: string): number | null {
  const s = cleanCell(status).toLowerCase();
  if (!s) return null;
  if (s.startsWith('verified')) return 90;
  if (s.startsWith('partial')) return 60;
  if (s.startsWith('not yet verified')) return 35;
  return 50;
}

function isAggregateRow(deptName: string): boolean {
  return /aggregate|total budget/i.test(deptName);
}

export function loadGovtFinance(filePath: string) {
  const [sheet] = readWorkbook(filePath, filePath);
  const rows = sheet ? sheet.rows : [];

  const records: any[] = [];
  let aggregateSkipped = 0;
  let noNameSkipped = 0;

  for (const row of rows) {
    const deptName = cleanCell(row['Department/Organization']);
    if (!deptName) {
      noNameSkipped++;
      continue;
    }
    if (isAggregateRow(deptName)) {
      aggregateSkipped++;
      continue;
    }

    const state = normalizeStateName(row['State/UT']);
    // NOT parentheses: normalizeForDedup() strips "(...)" entirely
    // (`.replace(/\(.*?\)/g, '')`, meant for "(Pvt Ltd)"-style suffixes),
    // which would silently collapse "School Education Department" across
    // all 6 states back into one dedupe key -- exactly the collision this
    // qualifier exists to prevent. An em dash survives that strip.
    const companyName = state ? `${deptName} — ${state}` : deptName;
    const parentMinistry = cleanCell(row['Parent Ministry']);
    const deptType = cleanCell(row['Department Type']);
    const sectorColumn = cleanCell(row['Sector']);
    const allocatedBudget = parseNumberCr(row['Allocated Budget (Cr)']);
    const itSpend = parseNumberCr(row['IT/Digital/Technology Spend (Cr)']) ?? parseNumberCr(row['State IT Budget Allocation (Cr)']);
    const fiscalYear = parseFiscalYear(row['Financial Year']);
    const sourceCitation = cleanCell(row['Source Document']) || null;
    const sourceUrl = cleanCell(row['Source URL']) || null;
    const confidence = verificationConfidence(row['Verification Status']);

    const summaryParts: string[] = [];
    if (parentMinistry) summaryParts.push(`Parent Ministry: ${parentMinistry}.`);
    if (deptType) summaryParts.push(`Department Type: ${deptType}.`);

    const rec: any = {
      companyName,
      subSector: sectorColumn || null,
      state: state || null,
      region: null,
      ownership: 'Government',
      profileSummary: summaryParts.length ? summaryParts.join(' ') : null,
      listedStatus: 'Unlisted',
      _source: 'master_govt_finance_database.xlsx',
      _dedupeKey: normalizeForDedup(companyName),
      _allocatedBudget: allocatedBudget,
      _itSpend: itSpend,
      _fiscalYear: fiscalYear,
      _confidence: confidence,
      _sourceCitation: sourceCitation,
      _sourceUrl: sourceUrl,
    };
    records.push(rec);
  }

  return {
    records,
    stats: {
      rowsRead: rows.length,
      aggregateSkipped,
      noNameSkipped,
      recordsBuilt: records.length,
      withAllocatedBudget: records.filter((r) => r._allocatedBudget != null).length,
      withItSpend: records.filter((r) => r._itSpend != null).length,
    },
  };
}
