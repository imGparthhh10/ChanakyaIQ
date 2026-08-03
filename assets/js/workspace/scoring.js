/**
 * scoring.js — Canonical opportunity-scoring function.
 *
 * Single source of truth for the score displayed on Company 360,
 * executive dashboards, filters, and score-movers. Previously the
 * same logic lived in three places and drifted.
 *
 * The returned object is auditable: every driver contributes with
 * a label + points so the UI can show WHY the score is what it is.
 */

/** Compute opportunity score with per-driver breakdown. */
export function opportunityScore(rec) {
  if (!rec) return { total: 0, drivers: [] };
  const drivers = [];

  const add = (label, points, hint) => {
    if (points <= 0) return;
    drivers.push({ label, points: Math.round(points), hint });
  };

  if (rec.buyingPotential) {
    const p = Math.min(rec.buyingPotential, 30);
    add(`Buying potential ₹${rec.buyingPotential} Cr/yr`, p, 'Estimated annual ESDS wallet');
  }
  if (rec.revenue) {
    const p = Math.min(rec.revenue / 5000, 15);
    add('Revenue scale', p, `Reported revenue ₹${Math.round(rec.revenue)} Cr`);
  }
  if (rec.itSpend) {
    const p = Math.min(rec.itSpend / 20, 15);
    add('IT investment', p, `IT spend ₹${Math.round(rec.itSpend)} Cr`);
  }
  if (rec.cloudSpend) {
    const p = Math.min(rec.cloudSpend / 10, 10);
    add('Existing cloud spend', p, `Cloud spend ₹${Math.round(rec.cloudSpend)} Cr — cloud-ready`);
  }
  if (rec.digitalMaturity === 'Medium') add('Digital in transition',   8, 'Medium digital maturity — active modernization');
  if (rec.digitalMaturity === 'Low')    add('Digital transformation runway', 12, 'Low digital maturity — greenfield opportunity');
  if (rec.cloudMaturity === 'Low')      add('Cloud modernization runway', 10, 'Low cloud maturity — infra uplift opportunity');
  if (rec.cyberMaturity === 'Low')      add('Cyber uplift opportunity', 8, 'Low cyber maturity — SOC/SIEM/DRaaS play');
  if (rec.aiReadiness   === 'Low' && (rec.revenue || 0) > 500) {
    add('Greenfield AI adoption', 6, 'Low AI readiness with material revenue base');
  }
  if (rec.painPoints) add('Documented pain points', 5, 'Explicit business/tech pain points on file');

  const total = Math.min(drivers.reduce((s, d) => s + d.points, 0), 100);
  return { total, drivers };
}

/** Just the number. Cheap. */
export function opportunityValue(rec) {
  return opportunityScore(rec).total;
}

/** Confidence — completeness across key fields. */
export function confidenceScore(rec) {
  if (!rec) return 0;
  const fields = ['revenue','itSpend','cloudMaturity','cyberMaturity','aiReadiness',
                  'digitalMaturity','ceo','cto','cio','techStack','painPoints','website'];
  const present = fields.filter(f => {
    const v = rec[f];
    return v != null && v !== '' && v !== 'NA';
  }).length;
  return Math.round((present / fields.length) * 100);
}

/** Bucket the score for tile / bar coloring. */
export function scoreTier(total) {
  if (total >= 65) return { tier: 'high', color: '#10B981', label: 'High' };
  if (total >= 40) return { tier: 'med',  color: '#F59E0B', label: 'Medium' };
  if (total > 0)   return { tier: 'low',  color: '#EF4444', label: 'Low' };
  return             { tier: 'none', color: '#64748B', label: 'No data' };
}
