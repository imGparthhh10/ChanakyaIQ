/**
 * engine.js — Recommendation scoring engine.
 *
 * Analyzes each company record against the ESDS product catalog
 * and produces ranked, prioritized recommendations with
 * justification, ROI, and implementation details.
 */

import { PRODUCTS, PRODUCT_LIST } from './products.js';

const PRIORITY_WEIGHT = { Critical: 4, High: 3, Medium: 2, Low: 1 };

/**
 * Score a single product against a company record.
 * Returns 0 if not relevant, 1–100 if relevant.
 */
function scoreProduct(product, rec) {
  let score = 0;
  let reasons = [];

  const t = product.triggers || {};

  // Cloud maturity match
  if (t.cloudMaturity && rec.cloudMaturity) {
    if (t.cloudMaturity.includes(rec.cloudMaturity)) {
      score += 20;
      reasons.push(`Cloud adoption is ${rec.cloudMaturity} — ready for cloud infrastructure uplift`);
    }
  }

  // AI readiness match
  if (t.aiReadiness && rec.aiReadiness) {
    if (t.aiReadiness.includes(rec.aiReadiness)) {
      score += 18;
      reasons.push(`AI readiness is ${rec.aiReadiness} — opportunity to accelerate AI capabilities`);
    }
  }

  // Cyber maturity match
  if (t.cyberMaturity && rec.cyberMaturity) {
    if (t.cyberMaturity.includes(rec.cyberMaturity)) {
      score += 22;
      reasons.push(`Cybersecurity maturity is ${rec.cyberMaturity} — needs strengthened defenses`);
    }
  }

  // Digital maturity match
  if (t.digitalMaturity && rec.digitalMaturity) {
    if (t.digitalMaturity.includes(rec.digitalMaturity)) {
      score += 15;
      reasons.push(`Digital maturity is ${rec.digitalMaturity} — digital transformation opportunity`);
    }
  }

  // Pain points text matching
  if (t.painAreas && t.painAreas.length > 0) {
    const painText = [
      rec.painPoints || '',
      rec.initiatives || '',
      rec.techStack || '',
      rec.notes || '',
      rec.esdsFitNotes || '',
    ].join(' ').toLowerCase();

    let painHits = 0;
    const matchedPains = [];
    for (const keyword of t.painAreas) {
      if (painText.includes(keyword.toLowerCase())) {
        painHits++;
        matchedPains.push(keyword);
      }
    }

    if (painHits > 0) {
      const painScore = Math.min(painHits * 8, 25);
      score += painScore;
      reasons.push(`Pain points align: ${matchedPains.slice(0, 3).join(', ')}`);
    }
  }

  // Category match
  if (t.categories && t.categories.length > 0 && rec.category) {
    if (t.categories.includes(rec.category)) {
      score += 12;
      reasons.push(`${rec.category} is a primary target segment for this solution`);
    }
  }

  // Revenue threshold
  if (t.minRevenue && rec.revenue) {
    if (rec.revenue >= t.minRevenue) {
      score += 5;
    } else {
      score -= 10;
    }
  }

  // IT spend signal — companies that spend on IT are better prospects
  if (rec.itSpend && rec.itSpend > 0) {
    score += Math.min(Math.round(rec.itSpend / 100) * 2, 8);
  }

  // Cloud spend signal — existing cloud spend means cloud-ready
  if (rec.cloudSpend && rec.cloudSpend > 0 && product.category === 'Cloud Infrastructure') {
    score += 6;
    reasons.push(`Already investing ₹${rec.cloudSpend} Cr in cloud`);
  }

  // Cyber spend signal
  if (rec.cyberSpend && rec.cyberSpend > 0 && product.category === 'Cybersecurity') {
    score += 6;
    reasons.push(`Current cyber spend: ₹${rec.cyberSpend} Cr — upgrade opportunity`);
  }

  // Buying potential multiplier
  if (rec.buyingPotential) {
    score += Math.min(Math.round(rec.buyingPotential / 10), 10);
  }

  return { score: Math.min(score, 100), reasons };
}

/**
 * Generate all recommendations for a single company.
 * Returns sorted array of recommendations above the threshold.
 */
export function recommendForCompany(rec, threshold = 15) {
  const results = [];

  for (const product of PRODUCT_LIST) {
    const { score, reasons } = scoreProduct(product, rec);
    if (score < threshold) continue;

    results.push({
      product,
      score,
      reasons,
      priority: product.priority,
      priorityWeight: PRIORITY_WEIGHT[product.priority] || 1,
      benefits: product.benefits,
      expectedROI: product.expectedROI,
      businessValue: product.businessValue,
      complexity: product.complexity,
      timeline: product.timeline,
    });
  }

  // Sort by priority weight desc, then score desc
  results.sort((a, b) => {
    if (b.priorityWeight !== a.priorityWeight) return b.priorityWeight - a.priorityWeight;
    return b.score - a.score;
  });

  return results;
}

/**
 * Generate top prospect companies with recommendations.
 * Analyzes all records and returns top N companies ranked by
 * total opportunity score across all matching products.
 */
export function generateTopProspects(records, topN = 12) {
  const prospects = [];

  for (const rec of records) {
    const recos = recommendForCompany(rec);
    if (recos.length === 0) continue;

    const totalScore = recos.reduce((s, r) => s + r.score, 0);
    const avgScore = Math.round(totalScore / recos.length);
    const topProduct = recos[0];

    prospects.push({
      company: rec,
      recommendations: recos,
      totalScore,
      avgScore,
      recoCount: recos.length,
      topProduct: topProduct.product,
      topScore: topProduct.score,
      topPriority: topProduct.priority,
    });
  }

  prospects.sort((a, b) => b.totalScore - a.totalScore);
  return prospects.slice(0, topN);
}

/**
 * Generate strategy summary across all records.
 * Counts how many companies each product is recommended for,
 * total addressable revenue, etc.
 */
export function generateStrategySummary(records) {
  const productHits = {};
  const categoryBreakdown = {};
  let totalAddressable = 0;
  let companiesWithRecos = 0;

  for (const rec of records) {
    const recos = recommendForCompany(rec);
    if (recos.length === 0) continue;
    companiesWithRecos++;
    totalAddressable += rec.buyingPotential || 0;

    for (const r of recos) {
      const pid = r.product.id;
      if (!productHits[pid]) {
        productHits[pid] = { product: r.product, count: 0, totalScore: 0, avgScore: 0 };
      }
      productHits[pid].count++;
      productHits[pid].totalScore += r.score;
    }

    const cat = rec.category || 'Other';
    categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + 1;
  }

  // Compute averages and sort
  const productRanking = Object.values(productHits)
    .map(h => ({ ...h, avgScore: Math.round(h.totalScore / h.count) }))
    .sort((a, b) => b.count - a.count);

  return {
    totalCompanies: records.length,
    companiesWithRecos,
    coveragePercent: Math.round((companiesWithRecos / records.length) * 100),
    totalAddressable,
    productRanking,
    categoryBreakdown,
  };
}
