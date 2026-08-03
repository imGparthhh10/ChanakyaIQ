/**
 * validator.js — Row validation and sanitization.
 *
 * Validates every parsed record, flags invalid rows,
 * fills missing optional fields with sensible defaults,
 * normalizes state/region names, and ensures data quality
 * before it enters the cache.
 *
 * Usage:
 *   import { validateRecords } from './validator.js';
 *   const { valid, invalid, stats } = validateRecords(records);
 */

/** States → Region lookup for missing region values. */
const STATE_REGION_MAP = {
  'andhra pradesh': 'South', 'arunachal pradesh': 'Northeast',
  'assam': 'Northeast', 'bihar': 'East', 'chhattisgarh': 'Central',
  'goa': 'West', 'gujarat': 'West', 'haryana': 'North',
  'himachal pradesh': 'North', 'jharkhand': 'East',
  'karnataka': 'South', 'kerala': 'South',
  'madhya pradesh': 'Central', 'maharashtra': 'West',
  'manipur': 'Northeast', 'meghalaya': 'Northeast',
  'mizoram': 'Northeast', 'nagaland': 'Northeast',
  'odisha': 'East', 'punjab': 'North', 'rajasthan': 'North',
  'sikkim': 'Northeast', 'tamil nadu': 'South',
  'telangana': 'South', 'tripura': 'Northeast',
  'uttar pradesh': 'North', 'uttarakhand': 'North',
  'west bengal': 'East',
  'nct of delhi': 'North', 'delhi': 'North',
  'chandigarh': 'North', 'puducherry': 'South',
  'jammu and kashmir': 'North', 'ladakh': 'North',
  'andaman and nicobar islands': 'South',
  'dadra and nagar haveli and daman and diu': 'West',
  'lakshadweep': 'South',
};

/** Common state name corrections. */
const STATE_CORRECTIONS = {
  'tamilnadu': 'Tamil Nadu',
  'karnatak': 'Karnataka',
  'maharastra': 'Maharashtra',
  'nct of delhi': 'Delhi',
  'ncr': 'Delhi',
  'new delhi': 'Delhi',
  'bengaluru': 'Karnataka',
};

/** Normalize a state name. */
function normalizeState(raw) {
  if (!raw) return '';
  let s = raw.trim();
  const lower = s.toLowerCase();
  if (STATE_CORRECTIONS[lower]) return STATE_CORRECTIONS[lower];
  // Title case
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Infer region from state if missing. */
function inferRegion(state) {
  if (!state) return '';
  return STATE_REGION_MAP[state.toLowerCase()] || '';
}

/** Normalize category names for consistent grouping. */
function normalizeCategory(raw) {
  if (!raw) return 'Other';
  const s = raw.trim();

  const lower = s.toLowerCase();
  if (lower.includes('public sector bank') || lower.includes('psu'))           return 'Public Sector Bank';
  if (lower.includes('private sector bank') || lower.includes('private bank')) return 'Private Bank';
  if (lower.includes('foreign bank'))         return 'Foreign Bank';
  if (lower.includes('small finance bank'))   return 'Small Finance Bank';
  if (lower.includes('payments bank'))        return 'Payments Bank';
  if (lower.includes('cooperative') || lower.includes('co-operative'))  return 'Cooperative Bank';
  if (lower.includes('regional rural') || lower.includes('rrb'))        return 'Regional Rural Bank';
  if (lower.includes('nbfc') || lower.includes('non-banking'))          return 'NBFC';
  if (lower.includes('housing finance') || lower.includes('hfc'))       return 'Housing Finance';
  if (lower.includes('microfinance') || lower.includes('mfi'))          return 'Microfinance';
  if (lower.includes('gold loan'))            return 'Gold Loan';
  if (lower.includes('vehicle finance'))      return 'Vehicle Finance';
  if (lower.includes('infrastructure finance')) return 'Infrastructure Finance';
  if (lower.includes('asset reconstruction') || lower.includes('arc')) return 'ARC';
  if (lower.includes('life insurance'))       return 'Life Insurance';
  if (lower.includes('general insurance'))    return 'General Insurance';
  if (lower.includes('health insurance'))     return 'Health Insurance';
  if (lower.includes('reinsurance'))          return 'Reinsurance';
  if (lower.includes('asset management') || lower.includes('amc') || lower.includes('mutual fund'))  return 'AMC';
  if (lower.includes('wealth') || lower.includes('portfolio management') || lower.includes('pms'))  return 'Wealth Management';
  if (lower.includes('stock brok') || lower.includes('securities'))     return 'Stock Broking';
  if (lower.includes('fintech'))              return 'FinTech';
  if (lower.includes('financial market') || lower.includes('fmi') || lower.includes('exchange') || lower.includes('depository'))  return 'Market Infrastructure';

  return s;
}

/** Clamp a number to a reasonable range, return null if out of bounds. */
function clampPositive(val) {
  if (val == null) return null;
  if (val < 0) return null;
  return val;
}

/**
 * Validate and sanitize an array of parsed records.
 *
 * @param {Object[]} records  Output from parseAllSheets.
 * @returns {{ valid: Object[], invalid: Object[], stats: Object }}
 */
export function validateRecords(records) {
  const valid = [];
  const invalid = [];
  const issues = {};

  for (const rec of records) {
    const errors = [];

    // --- Required: company name ---
    if (!rec.companyName || rec.companyName.length < 2) {
      errors.push('missing_company_name');
    }

    // --- Normalize state ---
    rec.state = normalizeState(rec.state);

    // --- Infer region if missing ---
    if (!rec.region && rec.state) {
      rec.region = inferRegion(rec.state);
    }

    // --- Normalize category ---
    rec.category = normalizeCategory(rec.category || rec.subSector);
    if (rec.subSector) rec.subSector = rec.subSector.trim();

    // --- Normalize city ---
    if (rec.hqCity) {
      rec.hqCity = rec.hqCity.trim().replace(/\s*\(.*?\)\s*$/, '');
    }

    // --- Clamp financial fields ---
    rec.revenue    = clampPositive(rec.revenue);
    rec.netProfit  = rec.netProfit;  // can be negative (loss)
    rec.marketCap  = clampPositive(rec.marketCap);
    rec.aum        = clampPositive(rec.aum);
    rec.itSpend    = clampPositive(rec.itSpend);
    rec.cloudSpend = clampPositive(rec.cloudSpend);
    rec.cyberSpend = clampPositive(rec.cyberSpend);
    rec.dcSpend    = clampPositive(rec.dcSpend);
    rec.aiSpend    = clampPositive(rec.aiSpend);
    rec.employeeCount  = clampPositive(rec.employeeCount);
    rec.branchCount    = clampPositive(rec.branchCount);
    rec.buyingPotential = clampPositive(rec.buyingPotential);

    // --- Normalize listed status ---
    if (rec.listedStatus) {
      const ls = rec.listedStatus.toLowerCase();
      if (ls.includes('listed') && !ls.includes('unlisted') && !ls.includes('not'))
        rec.listedStatus = 'Listed';
      else if (ls.includes('unlisted') || ls.includes('not'))
        rec.listedStatus = 'Unlisted';
      else
        rec.listedStatus = rec.listedStatus.trim();
    }

    // --- Normalize maturity levels ---
    for (const field of ['digitalMaturity', 'cloudMaturity', 'aiReadiness', 'cyberMaturity']) {
      if (rec[field]) {
        const v = rec[field].toLowerCase().trim();
        if (v.includes('high'))      rec[field] = 'High';
        else if (v.includes('med'))  rec[field] = 'Medium';
        else if (v.includes('low'))  rec[field] = 'Low';
        else rec[field] = rec[field].trim();
      }
    }

    // --- Generate a stable unique key for dedup ---
    rec._dedupeKey = normalizeForDedup(rec.companyName);

    // --- Verdict ---
    if (errors.length > 0) {
      rec._errors = errors;
      invalid.push(rec);
      for (const e of errors) issues[e] = (issues[e] || 0) + 1;
    } else {
      valid.push(rec);
    }
  }

  return {
    valid,
    invalid,
    stats: {
      totalInput: records.length,
      valid: valid.length,
      invalid: invalid.length,
      issues,
    },
  };
}

/**
 * Create a dedup key from a company name.
 * Strips common suffixes (Limited, Ltd, Ltd., Corporation, etc.),
 * normalizes whitespace and casing.
 */
export function normalizeForDedup(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/^\s*the\s+/i, '')      // strip leading "The"
    .replace(/\(.*?\)/g, '')         // strip parenthetical qualifiers
    .replace(/\b(limited|ltd\.?|pvt\.?|private|corporation|company|co\.?|inc\.?|llp|llc)\b/gi, '')
    .replace(/[^a-z0-9]/g, '')       // strip non-alphanumeric
    .trim();
}
