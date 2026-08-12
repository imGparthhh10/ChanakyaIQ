// Opportunity-tag assignment. Tag names were renamed to the ICP spec's
// fuller phrasing in migration 1_rename_tags (data-only — see
// backend/prisma/migrations/) — reverses the earlier "keep short names"
// call, reconfirmed explicitly with the user for this pass.
//
// Thresholds below are this service's own named defaults (matching the
// qualification thresholds where they overlap), not from any spec — freely
// adjustable, and a natural candidate for a future DB-driven tag_rules
// table if per-tag configurability from the dashboard is wanted later.
const HIGH_REVENUE_CR = 1000;
const HIGH_IT_SPEND_CR = 0.4;
const CLOUD_ADOPTER_CR = 0.4;
const CLOUD_GAP_CR = 0.1; // below this (or absent) = migration opportunity, not "adopter"
const CYBERSECURITY_FOCUS_CR = 0.4;
const LARGE_WORKFORCE_EMPLOYEES = 1000;
const MULTI_BRANCH_COUNT = 10;

interface OrgForTagging {
  ownershipType: string | null;
  sector?: { sectorName: string } | null;
  subsector?: { subsectorName: string } | null;
  technologyProfiles: { category: string; valueText: string }[];
}

export interface TagAssignment {
  tag: string;
  reason: string;
}

/**
 * Pure function — no DB access. Single source of truth for both the tag
 * list (assignOpportunityTags) and the human-readable "why" per tag
 * (explainOpportunityTags) — one rule table evaluated once, not two
 * functions that could drift apart.
 *
 * "AI Opportunity" / "Digital Transformation Opportunity" /
 * "Cloud Migration Opportunity" are deliberately whitespace signals
 * (low/no current investment = a pitch angle), not strength signals —
 * matches how the ICP spec itself frames "Opportunity"-suffixed tags
 * differently from the "High X" strength tags, and it's the only real
 * signal available today (no digital_transformation_spend was imported).
 */
function evaluateTagRules(org: OrgForTagging, metrics: Map<string, number>): TagAssignment[] {
  const revenue = metrics.get('revenue');
  const itSpend = metrics.get('it_spend');
  const cloudSpend = metrics.get('cloud_spend');
  const cyberSpend = metrics.get('cybersecurity_spend');
  const employeeCount = metrics.get('employee_count');
  const branchCount = metrics.get('branch_count');

  const digitalMaturity = org.technologyProfiles.find((p) => p.category === 'Digital Transformation Maturity')?.valueText;
  const aiReadiness = org.technologyProfiles.find((p) => p.category === 'AI Readiness')?.valueText;

  const rules: { tag: string; reason: string; matches: boolean }[] = [
    { tag: 'High Revenue Enterprise', reason: `Revenue ≥ ₹${HIGH_REVENUE_CR.toLocaleString('en-IN')} Cr`, matches: revenue != null && revenue >= HIGH_REVENUE_CR },
    { tag: 'High IT Investor', reason: `IT Spend ≥ ₹${Math.round(HIGH_IT_SPEND_CR * 100)} L`, matches: itSpend != null && itSpend >= HIGH_IT_SPEND_CR },
    { tag: 'High Cloud Adopter', reason: `Cloud Spend ≥ ₹${Math.round(CLOUD_ADOPTER_CR * 100)} L`, matches: cloudSpend != null && cloudSpend >= CLOUD_ADOPTER_CR },
    { tag: 'Cloud Migration Opportunity', reason: 'Little to no current cloud spend on file', matches: cloudSpend == null || cloudSpend < CLOUD_GAP_CR },
    { tag: 'Cybersecurity Focus', reason: `Cybersecurity Spend ≥ ₹${Math.round(CYBERSECURITY_FOCUS_CR * 100)} L`, matches: cyberSpend != null && cyberSpend >= CYBERSECURITY_FOCUS_CR },

    { tag: 'Government Owned', reason: 'Ownership type: Government', matches: org.ownershipType === 'Government' },
    { tag: 'Private Enterprise', reason: 'Ownership type: Private', matches: org.ownershipType === 'Private' },
    { tag: 'Listed Entity', reason: 'Ownership type: Public Listed', matches: org.ownershipType === 'Public_Listed' },
    {
      tag: 'Cooperative Bank',
      reason: 'Ownership type: Cooperative, or subsector name contains "cooperative"',
      matches: org.ownershipType === 'Cooperative' || /cooperative|co-operative/i.test(org.subsector?.subsectorName ?? ''),
    },
    { tag: 'Manufacturing', reason: 'Sector: Manufacturing', matches: org.sector?.sectorName === 'Manufacturing' },

    { tag: 'Large Workforce', reason: `Employee Count ≥ ${LARGE_WORKFORCE_EMPLOYEES.toLocaleString('en-IN')}`, matches: employeeCount != null && employeeCount >= LARGE_WORKFORCE_EMPLOYEES },
    { tag: 'Multi-Branch Enterprise', reason: `Branch Count ≥ ${MULTI_BRANCH_COUNT}`, matches: branchCount != null && branchCount >= MULTI_BRANCH_COUNT },

    // Only fire on an explicit "Low" reading, not merely absent data — most
    // orgs have no aiReadiness/digitalMaturity value at all (sparse source
    // data), and treating "unknown" as "opportunity" would tag nearly
    // everyone, making the tag meaningless as a differentiator.
    { tag: 'AI Opportunity', reason: 'AI Readiness rated Low', matches: aiReadiness === 'Low' },
    { tag: 'Digital Transformation Opportunity', reason: 'Digital Transformation Maturity rated Low', matches: digitalMaturity === 'Low' },
  ];

  return rules.filter((r) => r.matches).map((r) => ({ tag: r.tag, reason: r.reason }));
}

export function assignOpportunityTags(org: OrgForTagging, metrics: Map<string, number>): string[] {
  return evaluateTagRules(org, metrics).map((r) => r.tag);
}

/** Same rules, with the human-readable "why" per tag — for GET /organizations/:id/icp explainability. */
export function explainOpportunityTags(org: OrgForTagging, metrics: Map<string, number>): TagAssignment[] {
  return evaluateTagRules(org, metrics);
}
