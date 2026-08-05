// Opportunity-tag assignment — reuses the 13 tag names already seeded in
// eip_schema.sql (organization_tags/opportunity_tags were dormant before
// this: the tables existed but nothing wrote to them). No new tag rows are
// added; the ICP spec's fuller phrasing ("High Revenue Enterprise", "Listed
// Entity", ...) maps onto these existing short names.
//
// Thresholds below are this service's own named defaults (matching the
// qualification thresholds where they overlap), not from any spec — freely
// adjustable, and a natural candidate for a future DB-driven tag_rules
// table if per-tag configurability from the dashboard is wanted later.
const HIGH_REVENUE_CR = 1000;
const HIGH_IT_SPEND_CR = 0.4;
const CLOUD_ADOPTER_CR = 0.4;
const CYBERSECURITY_FOCUS_CR = 0.4;
const LARGE_WORKFORCE_EMPLOYEES = 1000;
const MULTI_BRANCH_COUNT = 10;

interface OrgForTagging {
  ownershipType: string | null;
  sector?: { sectorName: string } | null;
  subsector?: { subsectorName: string } | null;
  technologyProfiles: { category: string; valueText: string }[];
}

/**
 * Pure function — no DB access. AI Opportunity / Digital Transformation are
 * deliberately whitespace signals (low/no current investment = a pitch
 * angle), not strength signals, since that's the only real gap data we
 * have (no digital_transformation_spend was ever imported) and it matches
 * how the ICP spec itself frames those two tags differently from the
 * "High X" strength tags.
 */
export function assignOpportunityTags(org: OrgForTagging, metrics: Map<string, number>): string[] {
  const tags: string[] = [];

  const revenue = metrics.get('revenue');
  const itSpend = metrics.get('it_spend');
  const cloudSpend = metrics.get('cloud_spend');
  const cyberSpend = metrics.get('cybersecurity_spend');
  const employeeCount = metrics.get('employee_count');
  const branchCount = metrics.get('branch_count');

  const digitalMaturity = org.technologyProfiles.find((p) => p.category === 'Digital Transformation Maturity')?.valueText;
  const aiReadiness = org.technologyProfiles.find((p) => p.category === 'AI Readiness')?.valueText;

  if (revenue != null && revenue >= HIGH_REVENUE_CR) tags.push('High Revenue');
  if (itSpend != null && itSpend >= HIGH_IT_SPEND_CR) tags.push('High IT Spend');
  if (cloudSpend != null && cloudSpend >= CLOUD_ADOPTER_CR) tags.push('Cloud Adopter');
  if (cyberSpend != null && cyberSpend >= CYBERSECURITY_FOCUS_CR) tags.push('Cybersecurity Focus');

  if (org.ownershipType === 'Government') tags.push('Government');
  if (org.ownershipType === 'Private') tags.push('Private');
  if (org.ownershipType === 'Public_Listed') tags.push('Listed');
  if (org.ownershipType === 'Cooperative' || /cooperative|co-operative/i.test(org.subsector?.subsectorName ?? '')) {
    tags.push('Cooperative Bank');
  }
  if (org.sector?.sectorName === 'Manufacturing') tags.push('Manufacturing');

  if (employeeCount != null && employeeCount >= LARGE_WORKFORCE_EMPLOYEES) tags.push('Large Workforce');
  if (branchCount != null && branchCount >= MULTI_BRANCH_COUNT) tags.push('Multi Branch');

  // Only fire on an explicit "Low" reading, not merely absent data — most
  // orgs have no aiReadiness/digitalMaturity value at all (sparse source
  // data), and treating "unknown" as "opportunity" would tag nearly
  // everyone, making the tag meaningless as a differentiator.
  if (aiReadiness === 'Low') tags.push('AI Opportunity');
  if (digitalMaturity === 'Low') tags.push('Digital Transformation');

  return tags;
}
