import { IcpRepository } from './icp.repository';

const repo = new IcpRepository();

// score_weights.metric_id is NULL for every row eip_schema.sql seeds (the
// INSERT only sets component_name/weight_pct) — there is no formal FK link
// from a weight component to a metric to compute against. This mapping is
// this service's own resolution of that gap, flagged rather than silently
// assumed: 5 of the 7 seeded components map directly to a metric_key;
// "Organization Scale" and "Leadership" have no numeric metric equivalent
// in the imported data, so they use the heuristics documented inline below.
const COMPONENT_TO_METRIC_KEY: Record<string, string> = {
  Revenue: 'revenue',
  'IT Spend': 'it_spend',
  'Cloud Spend': 'cloud_spend',
  Cybersecurity: 'cybersecurity_spend',
  'Net Profit': 'net_profit',
};

// Tier thresholds are not specified anywhere in the original spec/schema —
// flagged as this service's own default rather than invented silently.
// Adjust freely; nothing downstream hardcodes these values.
function tierForScore(score: number): string {
  if (score >= 80) return 'Strategic';
  if (score >= 60) return 'Tier_1';
  if (score >= 40) return 'Tier_2';
  if (score >= 20) return 'Tier_3';
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

export interface IcpRunSummary {
  organizationsScored: number;
  qualified: number;
  tierBreakdown: Record<string, number>;
}

export async function runIcpScoring(): Promise<IcpRunSummary> {
  const [ruleGroups, scoreModels, orgs] = await Promise.all([
    repo.getActiveRuleGroups(),
    repo.getActiveScoreModels(),
    repo.allOrganizationsWithMetrics(),
  ]);

  // metricKey -> value per org, for both rules and weighted scoring
  const metricByOrg = new Map<string, Map<string, number>>();
  for (const org of orgs) {
    const m = new Map<string, number>();
    for (const fm of org.financialMetrics) m.set(fm.metricDefinition.metricKey, Number(fm.value));
    for (const tm of org.technologyMetrics) m.set(tm.metricDefinition.metricKey, Number(tm.value));
    metricByOrg.set(org.organizationId, m);
  }

  // Pre-sort each metric's population for percentile-rank normalization —
  // avoids fabricating arbitrary ceilings, self-calibrates to the actual data.
  const populationByMetric = new Map<string, number[]>();
  for (const m of metricByOrg.values()) {
    for (const [key, val] of m) {
      if (!populationByMetric.has(key)) populationByMetric.set(key, []);
      populationByMetric.get(key)!.push(val);
    }
  }
  for (const arr of populationByMetric.values()) arr.sort((a, b) => a - b);

  // Organization Scale heuristic population (employeeCount, falling back to
  // branchCount) — same percentile-rank treatment as a real metric.
  const scalePopulation: number[] = [];
  const scaleByOrg = new Map<string, number>();
  for (const org of orgs) {
    const m = metricByOrg.get(org.organizationId)!;
    const scale = m.get('employee_count') ?? m.get('branch_count') ?? 0;
    scaleByOrg.set(org.organizationId, scale);
    if (scale > 0) scalePopulation.push(scale);
  }
  scalePopulation.sort((a, b) => a - b);

  const summary: IcpRunSummary = { organizationsScored: 0, qualified: 0, tierBreakdown: {} };

  for (const org of orgs) {
    const metrics = metricByOrg.get(org.organizationId)!;

    // Qualification (ANY/ALL per rule_group.matchLogic)
    for (const group of ruleGroups) {
      const evaluations = group.qualificationRules.map((rule) => ({
        rule: `${rule.metricDefinition.metricKey} ${rule.operator} ${rule.thresholdValue}`,
        passed: evalRule(metrics.get(rule.metricDefinition.metricKey) ?? null, rule.operator, Number(rule.thresholdValue)),
      }));
      const isQualified = group.matchLogic === 'ALL'
        ? evaluations.every((e) => e.passed)
        : evaluations.some((e) => e.passed);
      await repo.recordQualification(org.organizationId, group.ruleGroupId, isQualified, evaluations);
      if (isQualified) summary.qualified++;
    }

    // Weighted ICP score
    for (const model of scoreModels) {
      let score = 0;
      for (const w of model.scoreWeights) {
        const weight = Number(w.weightPct) / 100;
        let subScore: number;
        if (w.componentName === 'Organization Scale') {
          subScore = percentileRank(scaleByOrg.get(org.organizationId) ?? 0, scalePopulation);
        } else if (w.componentName === 'Leadership') {
          const lp = org.leadershipProfile;
          const filled = [lp?.ceoName, lp?.ctoName, lp?.cioName, lp?.chairmanName].filter(Boolean).length;
          subScore = (filled / 4) * 100;
        } else {
          const metricKey = COMPONENT_TO_METRIC_KEY[w.componentName];
          const value = metricKey ? metrics.get(metricKey) : undefined;
          const population = metricKey ? populationByMetric.get(metricKey) ?? [] : [];
          subScore = value != null ? percentileRank(value, population) : 0;
        }
        score += subScore * weight;
      }
      score = Math.round(score * 100) / 100;
      const tier = tierForScore(score);
      await repo.recordScore(org.organizationId, model.scoreModelId, score, tier);
      summary.tierBreakdown[tier] = (summary.tierBreakdown[tier] ?? 0) + 1;
    }

    summary.organizationsScored++;
  }

  return summary;
}
