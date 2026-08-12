// Canonical Excel field (per assets/js/data/parser.js) -> metric_definitions.metric_key.
// Shared by organizations.mapper.ts (reads metrics back out) and the Phase 3
// import job (writes metrics in) so both sides agree on where each field lives.
// Fields not listed here have no financial/technology-metric home in eip_schema.sql
// (e.g. painPoints, techStack, notes) and are surfaced as null in API responses —
// flagged, not silently dropped.

/** Stored in financial_metrics. employeeCount/branchCount land here too — there is
 *  no separate "workforce_metrics" table in eip_schema.sql, and metric_definitions.category
 *  is descriptive metadata only, not a table selector. */
export const FINANCIAL_METRIC_FIELDS: Record<string, string> = {
  revenue: 'revenue',
  netProfit: 'net_profit',
  marketCap: 'market_cap',
  aum: 'aum',
  employeeCount: 'employee_count',
  branchCount: 'branch_count',
  buyingPotential: 'buying_potential_est',
  urgencyScore: 'urgency_score',
  dealSize: 'deal_size_est_cr',
  dataConfidenceScore: 'data_confidence_score',
  govtShareholding: 'govt_shareholding_pct',
  allocatedBudget: 'allocated_budget',
};

/** Stored in technology_metrics. */
export const TECHNOLOGY_METRIC_FIELDS: Record<string, string> = {
  itSpend: 'it_spend',
  cloudSpend: 'cloud_spend',
  cyberSpend: 'cybersecurity_spend',
  dcSpend: 'data_center_spend',
  aiSpend: 'ai_spend',
};

/** Stored in technology_profiles (categorical Low/Medium/High facts, not numeric metrics). */
export const TECHNOLOGY_PROFILE_FIELDS: Record<string, string> = {
  digitalMaturity: 'Digital Transformation Maturity',
  cloudMaturity: 'Cloud Adoption Level',
  aiReadiness: 'AI Readiness',
  cyberMaturity: 'Cybersecurity Maturity',
};

/** metric_key -> display name, for auto-seeding metric_definitions the first time a field is seen. */
export const METRIC_DISPLAY_NAMES: Record<string, string> = {
  revenue: 'Revenue',
  net_profit: 'Net Profit',
  market_cap: 'Market Capitalization',
  aum: 'Assets Under Management',
  employee_count: 'Employee Count',
  branch_count: 'Branch Count',
  buying_potential_est: 'Estimated Buying Potential',
  urgency_score: 'Urgency Score (1-10, imported estimate)',
  deal_size_est_cr: 'Estimated Deal Size',
  data_confidence_score: 'Data Confidence Score (1-5, imported estimate)',
  govt_shareholding_pct: 'Government Shareholding %',
  it_spend: 'IT Spend',
  cloud_spend: 'Cloud Spend',
  cybersecurity_spend: 'Cybersecurity Spend',
  data_center_spend: 'Data Center Spend',
  ai_spend: 'AI Spend',
  allocated_budget: 'Allocated Budget',
};
