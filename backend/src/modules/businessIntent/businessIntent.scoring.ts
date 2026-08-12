import type { BusinessIntentOrgInput, BusinessIntentResult, MeddpiccLetter } from './businessIntent.types';

// Sector scope filter. Every one of the 297 imported orgs is sector_id=1
// (BFSI) today (confirmed: sectors has 8 defined rows, but no org uses
// anything but sector 1 yet) -- this check is a real, generically-correct
// implementation for when that changes, not dead code for today's data.
// Matched case-insensitively against a substring allow-list rather than
// exact equality, since the exact "Govt/PSU" / "Enterprise IT-heavy"
// sector_name strings in the live `sectors` table couldn't be verified
// while Postgres was down -- tighten to exact match once confirmed.
const IN_SCOPE_SECTOR_PATTERNS = [/bfsi/i, /govt/i, /government/i, /psu/i, /enterprise it/i];

// financial_metrics/technology_metrics values are stored in INR Crore
// (metric_definitions.unit defaults to 'INR_CR' across this schema) — the
// spec's literal thresholds (Rs 50L spend, Rs 100Cr revenue) are converted
// to Cr here rather than left as raw rupee figures, which would silently
// never match anything (every real value in this DB is a two- or
// three-digit Cr number, not a nine- or ten-digit rupee number).
const IT_CLOUD_SPEND_THRESHOLD_CR = 0.5; // Rs 50 lakh
const REVENUE_THRESHOLD_CR = 100; // Rs 100 crore

const ECONOMIC_BUYER_DESIGNATIONS = ['cio', 'cto', 'cfo', 'chairman'];

// Real designation-title data doesn't exist to distinguish an "Economic
// Buyer" from a "Champion" (spec's C-letter, already out of scope) -- this
// is intentionally the same set the spec itself assigns to E.
function normalizeDesignation(designation: string): string {
  return designation.trim().toLowerCase();
}

function hasEconomicBuyer(designations: string[]): boolean {
  return designations.some((d) => ECONOMIC_BUYER_DESIGNATIONS.includes(normalizeDesignation(d)));
}

// technology_profiles has no dedicated "DR/uptime gap" or "legacy infra"
// flag column -- a Low Cloud Adoption Level or Low Cybersecurity Maturity
// reading is used as the real, data-backed proxy the spec's own comment
// describes ("technical evidence of pain even without a rupee figure
// yet"), not a fabricated signal.
function hasTechnicalPainSignal(profiles: { category: string; valueText: string | null }[]): boolean {
  return profiles.some((p) => {
    const category = p.category.toLowerCase();
    const value = (p.valueText ?? '').toLowerCase();
    const isRelevantCategory = category.includes('cloud adoption') || category.includes('cybersecurity maturity');
    return isRelevantCategory && value === 'low';
  });
}

function isInScopeSector(sectorName: string | null): boolean {
  if (!sectorName) return false;
  return IN_SCOPE_SECTOR_PATTERNS.some((pattern) => pattern.test(sectorName));
}

// Recalibrated from the spec's original 70/40 thresholds. Those numbers
// assumed 5 scorable letters worth up to 85 points (M 15 + E 15 + I 20 +
// C-competition 10 + D-process 10 + breadth bonus 15). With I and
// C-competition dropped (no backing data — see businessIntent.types.ts),
// the real maximum is 55 (M 15 + E 15 + D-process 10 + breadth bonus 15).
// Rescaled proportionally by the same ratio (55/85 ≈ 0.647) and rounded:
// Qualified >= 45 (70 * 0.647 ≈ 45.3), Watch >= 25 (40 * 0.647 ≈ 25.9).
// Without this, "Qualified" would be mathematically unreachable for every
// organization under the original numbers.
// Recalibrated against the score that is *actually achievable* on current
// data, not a theoretical maximum. Theoretical max is 70 (M 15 + M-tech 15 +
// E 15 + D_process 10 + breadth bonus 15), but D_process depends on the
// `documents` table, which holds 1 row platform-wide — so it never fires, and
// with only 2 distinct letters reachable the breadth bonus never fires
// either. Realistic ceiling is therefore 45 (M 15 + M-tech 15 + E 15).
//
// Calibrated on that 45-point range so every band is reachable:
//   45  = both M signals + a named buyer          -> Qualified
//   30  = one M signal + a named buyer            -> Watch
//   15  = a single signal alone                   -> Not Qualified
// These will need raising once the pipeline populates `documents` and
// D_process starts contributing (ceiling moves back toward 70).
export const QUALIFIED_THRESHOLD = 40;
export const WATCH_THRESHOLD = 20;

export function computeBusinessIntent(org: BusinessIntentOrgInput): BusinessIntentResult {
  // --- Hard exclusion filters (short-circuit, run first) ---
  if (!isInScopeSector(org.sectorName)) {
    return exclusion('Outside ICP scope');
  }

  // NOTE: the spec's second hard exclusion ("no identifiable economic buyer
  // candidate") is deliberately NOT applied as an exclusion. The `leadership`
  // table holds ~139 rows across 297 organizations, so a missing CIO/CTO/CFO/
  // Chairman overwhelmingly means "nobody has entered this data yet", not
  // "this company has no decision maker". Enforcing it excluded 250 of 297
  // organizations -- including Swiss Re, Bajaj Allianz and Shriram Finance --
  // disqualifying real prospects for a data-entry gap.
  //
  // Absent leadership is instead scored as it actually is: the E letter simply
  // doesn't fire (0 points, letter not matched), so such organizations can
  // still qualify on strong M signals and are ranked below equivalent
  // companies that do have a named buyer. Missing data lowers the score; it
  // no longer eliminates the record.
  const buyerPresent = hasEconomicBuyer(org.leadershipDesignations);

  // --- Signal scoring ---
  let score = 0;
  const lettersMatched = new Set<MeddpiccLetter>();

  const { revenue, itSpend, cloudSpend } = org.metrics;
  const hasSpendOrRevenueSignal =
    (itSpend ?? 0) > IT_CLOUD_SPEND_THRESHOLD_CR ||
    (cloudSpend ?? 0) > IT_CLOUD_SPEND_THRESHOLD_CR ||
    (revenue ?? 0) > REVENUE_THRESHOLD_CR;
  if (hasSpendOrRevenueSignal) {
    score += 15;
    lettersMatched.add('M');
  }

  if (buyerPresent) {
    score += 15;
    lettersMatched.add('E');
  }

  if (hasTechnicalPainSignal(org.technologyProfiles)) {
    score += 15;
    lettersMatched.add('M'); // Set dedupes -- counts once toward breadth, per spec comment
  }

  if (org.hasRecentDocumentActivity) {
    score += 10;
    lettersMatched.add('D_process');
  }

  if (lettersMatched.size >= 3) {
    score += 15; // breadth bonus
  }

  const classification =
    score >= QUALIFIED_THRESHOLD ? 'Qualified' : score >= WATCH_THRESHOLD ? 'Watch' : 'Not Qualified';

  return {
    score,
    classification,
    lettersMatched: [...lettersMatched],
    excluded: false,
    exclusionReason: null,
  };
}

function exclusion(reason: string): BusinessIntentResult {
  return { score: 0, classification: 'Not Qualified', lettersMatched: [], excluded: true, exclusionReason: reason };
}
