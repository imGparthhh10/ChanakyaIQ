/**
 * nlSearch.js — Natural-language query → filter set translator.
 *
 * Rule-based (deterministic, no LLM call, no network). Parses queries
 * like "banks in Maharashtra with low cyber maturity" into the same
 * `filters` object shape that DataCache.query() consumes.
 *
 * The parser is intentionally forgiving: unknown tokens are ignored,
 * partial matches produce partial filter sets, and the caller sees
 * exactly which tokens matched so the UI can show what was understood.
 *
 * Consumers:
 *   - Command palette recognizes when the user's query looks like NL
 *     and offers "Search matches …" as a shortcut option.
 *   - Filter panel could offer "Try natural language" (future).
 *
 * When an LLM is wired in later, keep this as the fallback + add an
 * async LLM path that returns the same shape.
 */

// ─── Vocab ────────────────────────────────────────

/** Sector keyword → canonical category strings (as they appear in the cache). */
const SECTOR_ALIASES = {
  'bank':                'Bank',
  'banks':               'Bank',
  'banking':             'Bank',
  'psu bank':            'Public Sector Bank',
  'public sector bank':  'Public Sector Bank',
  'private bank':        'Private Bank',
  'cooperative':         'Cooperative Bank',
  'coop bank':           'Cooperative Bank',
  'rrb':                 'Regional Rural Bank',
  'small finance':       'Small Finance Bank',
  'nbfc':                'NBFC',
  'nbfcs':               'NBFC',
  'insurance':           'Insurance',
  'life insurance':      'Life Insurance',
  'general insurance':   'General Insurance',
  'health insurance':    'Health Insurance',
  'reinsurance':         'Reinsurance',
  'broker':              'Stock Broking',
  'broking':             'Stock Broking',
  'stock broker':        'Stock Broking',
  'amc':                 'AMC',
  'mutual fund':         'AMC',
  'asset manager':       'AMC',
  'fintech':             'FinTech',
  'payments bank':       'Payments Bank',
  'payment bank':        'Payments Bank',
  'microfinance':        'Microfinance',
  'mfi':                 'Microfinance',
  'market infra':        'Market Infrastructure',
};

/** Rough state list — matches are case-insensitive, whole-word. */
const STATES = [
  'Maharashtra','Karnataka','Tamil Nadu','Telangana','Andhra Pradesh','Kerala',
  'Gujarat','Rajasthan','Punjab','Haryana','Uttar Pradesh','Madhya Pradesh',
  'West Bengal','Bihar','Odisha','Jharkhand','Chhattisgarh','Assam','Jammu and Kashmir',
  'Delhi','Goa','Uttarakhand','Himachal Pradesh','Puducherry','Chandigarh',
];

const REGIONS = ['West','South','North','East','Central','North-East'];

/** Big cities the parser recognizes even without "in <state>" context. */
const CITIES = [
  'Mumbai','Pune','Nagpur','Delhi','New Delhi','Gurugram','Gurgaon','Noida',
  'Bangalore','Bengaluru','Chennai','Hyderabad','Kolkata','Ahmedabad','Surat',
  'Jaipur','Lucknow','Chandigarh','Kochi','Ernakulam','Coimbatore','Vadodara',
  'Indore','Bhopal','Bhubaneswar','Guwahati','Patna','Ranchi','Nashik','Thane',
];

/**
 * Maturity attributes and their canonical field + level parsing.
 * Order matters — check "cloud" before "cybersecurity".
 */
const MATURITY_ATTRS = [
  { keys: ['cloud'],                                  field: 'cloudMaturity' },
  { keys: ['ai', 'artificial intelligence'],          field: 'aiReadiness' },
  { keys: ['cyber', 'cybersecurity', 'security'],     field: 'cyberMaturity' },
  { keys: ['digital', 'digital transformation'],      field: 'digitalMaturity' },
];

const LEVEL_WORDS = { low: 'Low', medium: 'Medium', med: 'Medium', high: 'High', advanced: 'High' };

const SIGNAL_ALIASES = {
  'buying signal':      'buying',
  'buying signals':     'buying',
  'active buying':      'buying',
  'in market':          'buying',
  'in-market':          'buying',
  'modernization':      'gap',
  'transformation':     'gap',
  'greenfield':         'gap',
  'cyber risk':         'risk',
  'cyber gap':          'risk',
  'security risk':      'risk',
  'active initiative':  'initiative',
  'ongoing initiative': 'initiative',
};

// ─── Helpers ──────────────────────────────────────

function matchOne(hay, needles) {
  const low = ' ' + hay + ' ';
  for (const n of needles) {
    const rx = new RegExp('\\b' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
    if (rx.test(low)) return n;
  }
  return null;
}

// ─── Parser ───────────────────────────────────────

/**
 * Parse a natural-language query into a filter object.
 *
 * @param {string} query
 * @returns {{ filters: Object, tokens: string[], understood: boolean }}
 *   filters:    the query filters (feed to DataCache.query)
 *   tokens:     human-readable list of what was understood
 *   understood: true if at least one recognizable token matched
 */
export function parseNL(query) {
  const filters = {};
  const tokens = [];
  const q = String(query || '').trim();
  if (!q) return { filters, tokens, understood: false };

  const low = q.toLowerCase();

  // ─── Sector ────────
  for (const [alias, canonical] of Object.entries(SECTOR_ALIASES)) {
    if (matchOne(low, [alias])) {
      filters.category = canonical;
      tokens.push(`Sector: ${canonical}`);
      break; // pick the first match; longer aliases first
    }
  }

  // ─── State ─────────
  for (const st of STATES) {
    if (matchOne(low, [st])) {
      filters.state = st;
      tokens.push(`State: ${st}`);
      break;
    }
  }

  // ─── Region ────────
  for (const rg of REGIONS) {
    if (matchOne(low, [rg])) {
      filters.region = rg;
      tokens.push(`Region: ${rg}`);
      break;
    }
  }

  // ─── City ──────────
  for (const city of CITIES) {
    if (matchOne(low, [city])) {
      filters.city = city;
      tokens.push(`City: ${city}`);
      break;
    }
  }

  // ─── Maturity attributes ("low cyber maturity") ────
  for (const attr of MATURITY_ATTRS) {
    for (const key of attr.keys) {
      const rx = new RegExp('\\b(low|medium|med|high|advanced)\\s+' + key + '(?:\\s+maturity|\\s+readiness|\\s+adoption)?', 'i');
      const m = low.match(rx);
      if (m) {
        const level = LEVEL_WORDS[m[1].toLowerCase()];
        filters[attr.field] = level;
        tokens.push(`${attr.field.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}: ${level}`);
        break;
      }
      // Also handle reverse: "cyber maturity low"
      const rx2 = new RegExp('\\b' + key + '(?:\\s+maturity|\\s+readiness|\\s+adoption)?\\s+(low|medium|med|high|advanced)', 'i');
      const m2 = low.match(rx2);
      if (m2) {
        const level = LEVEL_WORDS[m2[1].toLowerCase()];
        filters[attr.field] = level;
        tokens.push(`${attr.field.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}: ${level}`);
        break;
      }
    }
  }

  // ─── Buying-signal aliases ─────
  for (const [alias, signalType] of Object.entries(SIGNAL_ALIASES)) {
    if (matchOne(low, [alias])) {
      filters.signal = signalType;
      tokens.push(`Signal: ${signalType}`);
      break;
    }
  }

  // ─── Revenue bands ("revenue > 1000 cr", "large") ────
  // "large" → revenueMin 1000 · "small" → revenueMax 500
  if (/\blarge\b/.test(low))  { filters.revenueMin = 1000; tokens.push('Revenue: large (₹1,000 Cr+)'); }
  if (/\bmid[-\s]?sized?\b|\bmedium sized\b/.test(low)) { filters.revenueMin = 100; filters.revenueMax = 1000; tokens.push('Revenue: mid-size'); }
  if (/\bsmall\b/.test(low))  { filters.revenueMax = 500;  tokens.push('Revenue: small (< ₹500 Cr)'); }
  const revRx = /\brevenue\s*[><]=?\s*(\d+)/i.exec(low);
  if (revRx) {
    const val = parseInt(revRx[1], 10);
    if (/>/.test(revRx[0])) filters.revenueMin = val;
    if (/</.test(revRx[0])) filters.revenueMax = val;
    tokens.push(`Revenue: ${revRx[0]}`);
  }

  // ─── Ownership shortcuts ─────
  if (/\bmy (accounts|book|territory)\b/.test(low) || /\bassigned to me\b/.test(low)) {
    filters.owner = 'me';
    tokens.push('Owner: My accounts');
  } else if (/\bunassigned\b/.test(low) || /\bwhitespace\b/.test(low) || /\bwhite space\b/.test(low)) {
    filters.owner = 'unassigned';
    tokens.push('Owner: Unassigned');
  }

  // ─── Priority shortcuts ─────
  if (/\bhot\b|\btop priority\b|\bhigh priority\b/.test(low)) {
    // Approximate "hot" = high score threshold. We can't add a min-score
    // filter to DataCache without another lookup, so we route the caller
    // to a scoreMin filter (they can implement it, or we filter client-side).
    filters.scoreMin = 65;
    tokens.push('Score: ≥ 65 (Hot)');
  }

  return { filters, tokens, understood: tokens.length > 0 };
}

/**
 * Client-side post-filter for filters that DataCache doesn't natively support
 * (`scoreMin` — because scoring lives outside cache). Apply after cache.query.
 */
import { opportunityValue } from '../workspace/scoring.js';

export function applyPostFilters(records, filters) {
  if (!filters) return records;
  let out = records;
  if (filters.scoreMin != null) {
    const min = Number(filters.scoreMin);
    out = out.filter(r => opportunityValue(r) >= min);
  }
  return out;
}
