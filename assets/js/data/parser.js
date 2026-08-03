/**
 * parser.js — Column detection, header normalization, type-casting.
 *
 * Both Excel files use different column names for the same data.
 * This module maps every known header variant to a canonical field
 * name and casts values to the correct type.
 *
 * Canonical schema (after parsing):
 *   companyName, parentCompany, category, subSector, ownership,
 *   listedStatus, stockSymbol, cin, website, yearFounded,
 *   hqCity, state, region,
 *   revenue, netProfit, marketCap, aum,
 *   employeeCount, branchCount, customerBase,
 *   ceo, chairman, cio, cto, cfo, ciso,
 *   itSpend, cloudSpend, cyberSpend, dcSpend, aiSpend,
 *   corePlatform, techStack,
 *   digitalMaturity, cloudMaturity, aiReadiness, cyberMaturity,
 *   painPoints, initiatives, buyingPotential,
 *   notes, esdsFitNotes, verificationSources,
 *   urgencyScore, dealSize, recommendedProducts, businessJustification, dataConfidenceScore,
 *   _source (fileName + sheetName for traceability)
 */

const HEADER_MAP = buildHeaderMap();

function buildHeaderMap() {
  const map = new Map();

  const define = (canonical, ...variants) => {
    for (const v of variants) map.set(norm(v), canonical);
  };

  // Company identity — accepts every naming convention used across
  // the BFSI master files and the new Banking Master Database
  define('companyName',     'Company Name', 'Bank Name', 'Parent Bank Name');
  define('parentCompany',   'Parent Company', 'Sponsor Bank');
  define('category',        'Category', 'BFSI Sector', 'BFSI Category');
  define('subSector',       'Sub-Sector', 'Tier', 'Banking Subsector', 'Sub Sector');
  define('ownership',       'Ownership', 'Ownership Type');
  define('listedStatus',    'Listed/Unlisted', 'Listing Status', 'Status');
  define('stockSymbol',     'Stock Symbol');
  define('cin',             'CIN');
  define('website',         'Website', 'Official Website', 'Official Website (Parent)');
  define('yearFounded',     'Year Founded', 'Year Incorporated', 'Established');
  define('hqCity',          'Headquarters City', 'HQ City', 'India HQ City');
  define('state',           'State', 'Headquarters State', 'State / UT', 'State/UT');
  define('region',          'Region');

  // Banking-specific attributes
  define('govtShareholding',    'Govt. Shareholding %', 'Government Shareholding');
  define('countryOfOrigin',     'Country of Incorporation', 'Country of Origin');
  define('formOfPresence',      'Form of Presence in India', 'Form of Presence');
  define('sourceAsOfDate',      'Source / As-of Date', 'Source Date', 'As-of Date');

  define('revenue',         'Revenue / Total Income (FY26)', 'Total Income / Turnover FY25 (Rs Cr)', 'Revenue / Total Income', 'Total Income', 'Revenue');
  define('netProfit',       'Net Profit (FY26)', 'Net Profit FY25 (Rs Cr)', 'Net Profit');
  define('marketCap',       'Market Cap', 'Market Cap (Rs Cr)');
  define('marketCapDate',   'Market Cap As-Of Date');
  define('aum',             'AUM');
  define('employeeCount',   'Employee Count');
  define('branchCount',     'Branch Network', 'Domestic Branches (count)', 'Branches / Access Points (count)');
  define('customerBase',    'Customer Base');

  define('ceo',             'Managing Director / CEO', 'CEO / MD Name & Designation');
  define('chairman',        'Chairman');
  define('cio',             'CIO');
  define('cto',             'CTO');
  define('cfo',             'CFO');
  define('ciso',            'CISO');

  define('itSpend',         'Estimated IT Spend', 'Est. Annual IT Spend (Rs Cr)');
  define('cloudSpend',      'Estimated Cloud Spend', 'Est. Cloud Spend (Rs Cr)');
  define('cyberSpend',      'Estimated Cyber Security Spend', 'Est. Cybersecurity Spend (Rs Cr)');
  define('dcSpend',         'Estimated Data Center Spend');
  define('aiSpend',         'Est. AI/GPU Infra Spend (Rs Cr)');

  define('corePlatform',    'Core Banking / Core Platform');
  define('techStack',       'Current Technology Stack (known/publicly reported)');

  define('digitalMaturity', 'Digital Transformation Maturity (Low/Med/High)');
  define('cloudMaturity',   'Cloud Adoption Level (Low/Med/High)');
  define('aiReadiness',     'AI Readiness (Low/Med/High)');
  define('cyberMaturity',   'Cybersecurity Maturity (Low/Med/High)');

  define('regulatoryNotes', 'Key Regulatory Obligations');
  define('painPoints',      'Major Business & Tech Pain Points');
  define('initiatives',     'Ongoing Digital Initiatives');
  define('buyingPotential', 'Estimated Buying Potential (Rs Cr/yr)');

  define('notes',           'Recent Leadership Change / Notes', 'Coverage Note');
  define('esdsFitNotes',    'ESDS Fit Notes');
  define('verificationSources', 'Verification Sources', 'Verification Source');

  define('urgencyScore',    'Urgency Score (1-10)');
  define('dealSize',        'Estimated Deal Size (Rs Cr)');
  define('recommendedProducts', 'Recommended ESDS Products');
  define('businessJustification', 'Business Justification');
  define('dataConfidenceScore', 'Data Confidence Score (1-5)');

  return map;
}

/** Normalize a header string for matching. */
function norm(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Build a column mapping for a given set of raw headers.
 * Returns { rawHeader → canonicalField } map + unmapped headers list.
 */
function detectColumns(rawHeaders) {
  const mapping = {};
  const unmapped = [];

  for (const raw of rawHeaders) {
    const key = norm(raw);
    const canonical = HEADER_MAP.get(key);
    if (canonical) {
      mapping[raw] = canonical;
    } else {
      unmapped.push(raw);
    }
  }

  return { mapping, unmapped };
}

/**
 * Parse a numeric value from Excel's string output.
 * Handles "Rs 1,234.56 cr", "$512M", "N/A", "NA", etc.
 */
export function parseNumber(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || s === 'NA' || s === 'N/A' || s === '-' || s === '—') return null;

  let cleaned = s
    .replace(/^Rs\.?\s*/i, '')
    .replace(/^₹\s*/, '')
    .replace(/^\$\s*/, '')
    .replace(/\s*cr(ore)?s?\s*$/i, '')
    .replace(/\s*lakh\s*cr(ore)?s?\s*$/i, (m) => { return ''; })
    .replace(/,/g, '');

  // Handle lakh cr multiplier
  if (/lakh\s*cr/i.test(s)) {
    const numPart = parseFloat(cleaned);
    return isNaN(numPart) ? null : numPart * 100000;
  }

  // Handle "~" prefix
  cleaned = cleaned.replace(/^~/, '');

  // Handle "$512M" style
  if (/\d+(\.\d+)?\s*[BMT]$/i.test(cleaned)) {
    const mult = { B: 1000, M: 1, T: 1000000 };
    const letter = cleaned.slice(-1).toUpperCase();
    const num = parseFloat(cleaned.slice(0, -1));
    return isNaN(num) ? null : num * (mult[letter] || 1);
  }

  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/**
 * Parse a year (4 digits) from a cell value.
 */
function parseYear(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  const match = s.match(/\b(1[89]\d{2}|20[0-4]\d)\b/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Clean a text field: trim, replace NA/N/A with empty.
 */
function cleanText(raw) {
  if (raw == null) return '';
  const s = String(raw).trim();
  if (s === 'NA' || s === 'N/A' || s === '-' || s === '—') return '';
  return s;
}

/** Fields that should be parsed as numbers. */
const NUMERIC_FIELDS = new Set([
  'revenue', 'netProfit', 'marketCap', 'aum',
  'employeeCount', 'branchCount',
  'itSpend', 'cloudSpend', 'cyberSpend', 'dcSpend', 'aiSpend',
  'buyingPotential',
  'govtShareholding',   // percent
  'urgencyScore', 'dealSize', 'dataConfidenceScore',
]);

const YEAR_FIELDS = new Set(['yearFounded']);

/**
 * Parse all rows from a single sheet into canonical objects.
 *
 * @param {{ sheetName, fileName, headers, rows }} sheetData
 * @returns {{ records: Object[], unmappedHeaders: string[], stats: Object }}
 */
export function parseSheet(sheetData) {
  const { sheetName, fileName, headers, rows } = sheetData;
  const { mapping, unmapped } = detectColumns(headers);
  const source = `${fileName}::${sheetName}`;

  const records = [];
  let skipped = 0;

  for (const rawRow of rows) {
    const rec = { _source: source };

    for (const [rawHeader, canonical] of Object.entries(mapping)) {
      const rawVal = rawRow[rawHeader];

      if (NUMERIC_FIELDS.has(canonical)) {
        rec[canonical] = parseNumber(rawVal);
      } else if (YEAR_FIELDS.has(canonical)) {
        rec[canonical] = parseYear(rawVal);
      } else {
        rec[canonical] = cleanText(rawVal);
      }
    }

    // Must have a company name to be useful
    if (!rec.companyName) {
      skipped++;
      continue;
    }

    records.push(rec);
  }

  return {
    records,
    unmappedHeaders: unmapped,
    stats: {
      source,
      total: rows.length,
      parsed: records.length,
      skipped,
      columnsMapped: Object.keys(mapping).length,
      columnsUnmapped: unmapped.length,
    },
  };
}

/**
 * Parse all sheets from loadExcelFiles output into a flat
 * array of canonical records.
 *
 * @param {Array} sheetsData  Output from loadExcelFiles().
 * @returns {{ records: Object[], parseStats: Object[] }}
 */
export function parseAllSheets(sheetsData) {
  const allRecords = [];
  const parseStats = [];

  for (const sheet of sheetsData) {
    const { records, stats } = parseSheet(sheet);
    allRecords.push(...records);
    parseStats.push(stats);
  }

  return { records: allRecords, parseStats };
}
