import { IcpRepository } from './icp.repository';
import { assignOpportunityTags } from './tags.service';

const repo = new IcpRepository();

// score_weights.metric_id is NULL for every row eip_schema.sql seeds (the
// INSERT only sets component_name/weight_pct) — there is no formal FK link
// from a weight component to a metric to compute against. This mapping is
// this service's own resolution of that gap, flagged rather than silently
// assumed: 5 of the 7 seeded components map directly to a metric_key;
// "Organization Scale" and "Leadership & Contact Availability" have no
// numeric metric equivalent in the imported data, so they use the
// heuristics documented inline below.
const COMPONENT_TO_METRIC_KEY: Record<string, string> = {
  Revenue: 'revenue',
  'IT Spend': 'it_spend',
  'Cloud Spend': 'cloud_spend',
  Cybersecurity: 'cybersecurity_spend',
  'Net Profit': 'net_profit',
  'Allocated Budget': 'allocated_budget',
  'IT/Digital Spend': 'it_spend',
};

// Tier thresholds per the ICP spec: 90-100 Strategic, 75-89 Tier 1,
// 60-74 Tier 2, 40-59 Tier 3, below 40 Watchlist.
function tierForScore(score: number): string {
  if (score >= 90) return 'Strategic';
  if (score >= 75) return 'Tier_1';
  if (score >= 60) return 'Tier_2';
  if (score >= 40) return 'Tier_3';
  return 'Watchlist';
}

function percentileRank(value: number, sorted: number[]): number {
  if (sorted.length === 0) return 0;
  let countLE = 0;
  for (const v of sorted) if (v <= value) countLE++;
  return (countLE / sorted.length) * 100;
}

function evalRule(value: number | null, operator: string, threshold: number): boolean {
  if (value == null) return false;
  switch (operator) {
    case '>=': return value >= threshold;
    case '<=': return value <= threshold;
    case '>': return value > threshold;
    case '<': return value < threshold;
    case '=': return value === threshold;
    default: return false;
  }
}

const OPERATOR_SYMBOL: Record<string, string> = { '>=': '≥', '<=': '≤', '>': '>', '<': '<', '=': '=' };

/** e.g. "Revenue ≥ ₹1,000 Cr", "IT Spend ≥ ₹40 L" — Cr for
 *  thresholds ≥ 1, Lakh otherwise, matching the ICP spec's own example phrasing. */
function formatReason(displayName: string, operator: string, threshold: number, unit: string): string {
  const symbol = OPERATOR_SYMBOL[operator] ?? operator;
  if (unit !== 'INR_CR') return `${displayName} ${symbol} ${threshold.toLocaleString('en-IN')} ${unit}`;
  if (threshold >= 1) return `${displayName} ${symbol} ₹${threshold.toLocaleString('en-IN')} Cr`;
  return `${displayName} ${symbol} ₹${Math.round(threshold * 100).toLocaleString('en-IN')} L`;
}

// How many historical qualification_results rows to keep per (org, rule
// group) pair -- see icp.repository.ts's pruneQualificationHistory() for
// why this table needs pruning at all. 10 is generous headroom over what
// the UI/API ever reads (only the single latest row, via latestForOrg())
// while still leaving a real trail to inspect manually if needed.
const QUALIFICATION_HISTORY_RETAIN_PER_ORG = 10;

export interface IcpRunSummary {
  organizationsScored: number;
  qualified: number;
  tagsAssigned: number;
  tierBreakdown: Record<string, number>;
  qualificationHistoryRowsPruned: number;
}

export async function runIcpScoring(): Promise<IcpRunSummary> {
  const [ruleGroups, scoreModels, orgs] = await Promise.all([
    repo.getActiveRuleGroups(),
    repo.getActiveScoreModels(),
    repo.allOrganizationsWithMetrics(),
  ]);

  // metricKey -> value per org, for both rules and weighted scoring
  const metricByOrg = new Map<string, Map<string, number>>();
  const sectorByOrg = new Map<string, number | null>();
  for (const org of orgs) {
    const m = new Map<string, number>();
    for (const fm of org.financialMetrics) m.set(fm.metricDefinition.metricKey, Number(fm.value));
    for (const tm of org.technologyMetrics) m.set(tm.metricDefinition.metricKey, Number(tm.value));
    metricByOrg.set(org.organizationId, m);
    sectorByOrg.set(org.organizationId, org.sectorId ?? null);
  }

  // Pre-sort each metric's population **within the org's own sector** for
  // percentile-rank normalization (Stage 8: sector independence) — a BFSI
  // company is only ever compared against other BFSI companies, not
  // diluted by unrelated sectors once those get imported. Currently a
  // mathematical no-op vs. a single global population, since 100% of
  // imported data is sector 1 (BFSI) today — but it's the correct design
  // the moment a second sector lands, with zero further code changes.
  // Keyed by `${sectorId}:${metricKey}`.
  const populationByMetric = new Map<string, number[]>();
  for (const org of orgs) {
    const m = metricByOrg.get(org.organizationId)!;
    const sectorId = sectorByOrg.get(org.organizationId) ?? null;
    for (const [key, val] of m) {
      const popKey = `${sectorId}:${key}`;
      if (!populationByMetric.has(popKey)) populationByMetric.set(popKey, []);
      populationByMetric.get(popKey)!.push(val);
    }
  }
  for (const arr of populationByMetric.values()) arr.sort((a, b) => a - b);

  // Organization Scale heuristic population (employeeCount, falling back to
  // branchCount) — same within-sector percentile-rank treatment.
  const scalePopulationBySector = new Map<number | null, number[]>();
  const scaleByOrg = new Map<string, number>();
  for (const org of orgs) {
    const m = metricByOrg.get(org.organizationId)!;
    const scale = m.get('employee_count') ?? m.get('branch_count') ?? 0;
    scaleByOrg.set(org.organizationId, scale);
    const sectorId = sectorByOrg.get(org.organizationId) ?? null;
    if (scale > 0) {
      if (!scalePopulationBySector.has(sectorId)) scalePopulationBySector.set(sectorId, []);
      scalePopulationBySector.get(sectorId)!.push(scale);
    }
  }
  for (const arr of scalePopulationBySector.values()) arr.sort((a, b) => a - b);

  const summary: IcpRunSummary = {
    organizationsScored: 0, qualified: 0, tagsAssigned: 0, tierBreakdown: {},
    qualificationHistoryRowsPruned: 0,
  };
  const qualifiedOrgIds = new Set<string>();

  for (const org of orgs) {
    const metrics = metricByOrg.get(org.organizationId)!;
    const sectorId = sectorByOrg.get(org.organizationId) ?? null;

    // Qualification (ANY/ALL per rule_group.matchLogic), scoped to the
    // org's own sector -- a NULL rule_group.sectorId applies to every
    // sector (kept for forward compatibility), a set sectorId only ever
    // runs against organizations in that sector. Without this, e.g. the
    // Government rule group's Allocated Budget check would also evaluate
    // (harmlessly, but confusingly) against every BFSI org, and BFSI's
    // Revenue/Net Profit/Cloud/Cybersecurity rules would run against
    // Government orgs that were never expected to carry those metrics.
    for (const group of ruleGroups) {
      if (group.sectorId != null && group.sectorId !== sectorId) continue;
      const evaluations = group.qualificationRules.map((rule) => {
        const value = metrics.get(rule.metricDefinition.metricKey) ?? null;
        const threshold = Number(rule.thresholdValue);
        return {
          rule: `${rule.metricDefinition.metricKey} ${rule.operator} ${threshold}`,
          reason: formatReason(rule.metricDefinition.displayName, rule.operator, threshold, rule.metricDefinition.unit),
          // A metric that was simply never disclosed for this org must not
          // count as "failed that threshold" -- it's excluded from the
          // ANY/ALL aggregation below entirely, not folded in as a false.
          evaluated: value != null,
          passed: evalRule(value, rule.operator, threshold),
        };
      });
      const evaluatedRules = evaluations.filter((e) => e.evaluated);
      // Vacuous truth guard: if literally nothing was disclosed, an
      // ALL-logic group must not default to "every (zero) rule passed".
      const isQualified = evaluatedRules.length === 0
        ? false
        : group.matchLogic === 'ALL'
          ? evaluatedRules.every((e) => e.passed)
          : evaluatedRules.some((e) => e.passed);
      await repo.recordQualification(org.organizationId, group.ruleGroupId, isQualified, evaluations);
      if (isQualified) qualifiedOrgIds.add(org.organizationId);
    }

    // Weighted ICP score -- same sector scoping as rule groups above.
    for (const model of scoreModels) {
      if (model.sectorId != null && model.sectorId !== sectorId) continue;

      // Same "missing ≠ failed" principle as qualification rules above,
      // applied to weighted scoring: a metric-backed component (Revenue,
      // IT Spend, Allocated Budget, ...) that was never disclosed must not
      // silently score 0 and drag the weighted total down by its full
      // weight -- that penalizes "unknown" as if it were "bad". Instead
      // it's excluded, and the remaining *disclosed* components' weights
      // are renormalized to sum to 100%. Organization Scale and Leadership
      // & Contact Availability are heuristic composites with their own
      // built-in graceful-zero-default (a 0/4 leadership ratio is a real,
      // meaningful answer, not an absence of one) -- they always
      // participate and are never treated as "undisclosed".
      // Concretely: this is why 461 of 478 Government orgs (96.4%, missing
      // IT/Digital Spend) previously capped at icp_score ≤61 -- 60% of the
      // model's max -- instead of scoring on the 60% they actually did
      // disclose (Allocated Budget) at its full, un-diluted weight.
      const components: { subScore: number; weight: number; evaluated: boolean }[] = [];
      for (const w of model.scoreWeights) {
        const weight = Number(w.weightPct) / 100;
        if (w.componentName === 'Organization Scale') {
          const subScore = percentileRank(scaleByOrg.get(org.organizationId) ?? 0, scalePopulationBySector.get(sectorId) ?? []);
          components.push({ subScore, weight, evaluated: true });
        } else if (w.componentName === 'Leadership & Contact Availability') {
          const lp = org.leadershipProfile;
          const leadershipFilled = [lp?.ceoName, lp?.ctoName, lp?.cioName, lp?.chairmanName].filter(Boolean).length;
          const leadershipScore = (leadershipFilled / 4) * 100;
          // contacts is 100% empty today (no Point-of-Contact/Email/Phone
          // columns were ever imported) — this stays 0 for every org until
          // real contact data exists (e.g. from the enrichment pipeline),
          // at which point it starts contributing automatically.
          const contactScore = org.contacts.length > 0 ? 100 : 0;
          components.push({ subScore: (leadershipScore + contactScore) / 2, weight, evaluated: true });
        } else {
          const metricKey = COMPONENT_TO_METRIC_KEY[w.componentName];
          const value = metricKey ? metrics.get(metricKey) : undefined;
          if (value == null) {
            components.push({ subScore: 0, weight, evaluated: false });
          } else {
            const population = metricKey ? populationByMetric.get(`${sectorId}:${metricKey}`) ?? [] : [];
            components.push({ subScore: percentileRank(value, population), weight, evaluated: true });
          }
        }
      }

      const disclosedWeight = components.filter((c) => c.evaluated).reduce((sum, c) => sum + c.weight, 0);
      // Vacuous truth guard, same as qualification: if nothing at all was
      // disclosed, the score is 0 (Watchlist) -- not undefined, not a
      // divide-by-zero, and not "every component defaults to 100%".
      let score = disclosedWeight === 0
        ? 0
        : components
            .filter((c) => c.evaluated)
            .reduce((sum, c) => sum + c.subScore * (c.weight / disclosedWeight), 0);

      score = Math.round(score * 100) / 100;
      const tier = tierForScore(score);
      await repo.recordScore(org.organizationId, model.scoreModelId, score, tier);
      summary.tierBreakdown[tier] = (summary.tierBreakdown[tier] ?? 0) + 1;
    }

    // Opportunity tags — see tags.service.ts for the rule table.
    const tags = assignOpportunityTags(org, metrics);
    await repo.replaceOrgTags(org.organizationId, tags);
    summary.tagsAssigned += tags.length;

    summary.organizationsScored++;
  }

  summary.qualified = qualifiedOrgIds.size;

  // Prune qualification_results down to the N most recent rows per (org,
  // rule group) after every run, so this history table never grows
  // unbounded. score_history/tier_history are untouched -- they're the
  // real long-term trend record, not an append-only-by-accident log.
  summary.qualificationHistoryRowsPruned = await repo.pruneQualificationHistory(QUALIFICATION_HISTORY_RETAIN_PER_ORG);

  return summary;
}
