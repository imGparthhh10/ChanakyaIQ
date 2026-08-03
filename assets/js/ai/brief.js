/**
 * brief.js — AI-style structured account brief generator.
 *
 * Produces a 4-section narrative (Situation · Signals · Fit thesis ·
 * Approach) with per-claim citations back to the source fields on the
 * record. No LLM call — this is a deterministic, template-driven
 * generator that cites actual data, so users can audit every claim.
 *
 * When a real LLM is integrated later, replace `generate()` with an
 * async fn that returns the same shape; every consumer keeps working.
 *
 * Output shape:
 *   {
 *     sections: [{ title, paragraphs: [{ text, cites: [{ label, value }] }] }],
 *     talkingPoints: string[],
 *     nextActions:   string[],
 *   }
 */

import { opportunityScore, confidenceScore } from '../workspace/scoring.js';
import { recommendForCompany }               from '../recommendations/engine.js';
import { deriveSignalTypes }                 from '../workspace/signals.js';

const fmtCr = (n) => n == null ? '—' : (n >= 1000 ? '₹' + (n / 1000).toFixed(1) + 'K Cr' : '₹' + Number(n).toFixed(0) + ' Cr');

/** Build a citation object. */
const cite = (label, value) => ({ label, value: value == null ? '—' : String(value) });

// ─── Section: Situation ───────────────────────────

function situation(rec) {
  const paras = [];

  const bits = [];
  if (rec.category)                        bits.push(`operates in ${rec.category}`);
  if (rec.subSector && rec.subSector !== rec.category) bits.push(`(${rec.subSector})`);
  if (rec.hqCity && rec.state)             bits.push(`from ${rec.hqCity}, ${rec.state}`);
  else if (rec.state)                      bits.push(`headquartered in ${rec.state}`);

  const line1 = `${rec.companyName} ${bits.join(' ')}.`;
  const cites1 = [];
  if (rec.category)  cites1.push(cite('Sector', rec.category));
  if (rec.state)     cites1.push(cite('State',  rec.state));
  if (rec.hqCity)    cites1.push(cite('City',   rec.hqCity));
  paras.push({ text: line1, cites: cites1 });

  const finBits = [];
  const finCites = [];
  if (rec.revenue)       { finBits.push(`revenue of ${fmtCr(rec.revenue)}`);           finCites.push(cite('Revenue', fmtCr(rec.revenue))); }
  if (rec.netProfit)     { finBits.push(`net profit ${fmtCr(rec.netProfit)}`);         finCites.push(cite('Net profit', fmtCr(rec.netProfit))); }
  if (rec.employeeCount) { finBits.push(`${Number(rec.employeeCount).toLocaleString('en-IN')} employees`); finCites.push(cite('Employees', rec.employeeCount.toLocaleString('en-IN'))); }
  if (rec.branchCount)   { finBits.push(`${rec.branchCount} branches`);                finCites.push(cite('Branches', rec.branchCount)); }
  if (finBits.length) {
    paras.push({ text: `Reported ${finBits.join(', ')}.`, cites: finCites });
  }

  const techBits = [];
  const techCites = [];
  if (rec.itSpend)    { techBits.push(`IT spend ${fmtCr(rec.itSpend)}`);       techCites.push(cite('IT spend', fmtCr(rec.itSpend))); }
  if (rec.cloudSpend) { techBits.push(`cloud spend ${fmtCr(rec.cloudSpend)}`); techCites.push(cite('Cloud spend', fmtCr(rec.cloudSpend))); }
  if (rec.cyberSpend) { techBits.push(`cyber spend ${fmtCr(rec.cyberSpend)}`); techCites.push(cite('Cyber spend', fmtCr(rec.cyberSpend))); }
  if (techBits.length) {
    paras.push({ text: `Technology posture: ${techBits.join(' · ')}.`, cites: techCites });
  }

  return { title: 'Situation', paragraphs: paras };
}

// ─── Section: Signals — why now ───────────────────

function signals(rec) {
  const paras = [];
  const types = deriveSignalTypes(rec);

  const bullets = [];
  const cites   = [];

  if (types.has('buying')) {
    bullets.push(`Estimated ₹${rec.buyingPotential} Cr/yr in addressable ESDS wallet`);
    cites.push(cite('Buying potential', rec.buyingPotential + ' Cr/yr'));
  }
  if (types.has('gap') && rec.cloudMaturity === 'Low') {
    bullets.push('Low cloud maturity — modernization runway is open now');
    cites.push(cite('Cloud maturity', rec.cloudMaturity));
  }
  if (types.has('gap') && rec.aiReadiness === 'Low' && (rec.revenue || 0) > 500) {
    bullets.push('Material revenue but nascent AI adoption — greenfield AI opportunity');
    cites.push(cite('AI readiness', rec.aiReadiness));
    cites.push(cite('Revenue',      fmtCr(rec.revenue)));
  }
  if (types.has('risk') && rec.cyberMaturity === 'Low') {
    bullets.push('Low cyber maturity — SOC / SIEM / DRaaS uplift is time-sensitive');
    cites.push(cite('Cyber maturity', rec.cyberMaturity));
  }
  if (types.has('initiative') && rec.initiatives) {
    bullets.push(`Ongoing initiatives (${String(rec.initiatives).slice(0, 80).trim()}) indicate active budget cycles`);
    cites.push(cite('Initiatives', 'On file'));
  }
  if (rec.painPoints) {
    bullets.push('Documented business & tech pain points align with ESDS solution portfolio');
    cites.push(cite('Pain points', 'On file'));
  }

  if (bullets.length === 0) {
    paras.push({ text: 'No high-confidence timing signals derived from the current data. Monitor for updates or add first-party research notes.', cites: [] });
  } else {
    paras.push({ text: 'The following signals justify prioritizing this account today:', cites: [] });
    for (const b of bullets) paras.push({ text: '• ' + b, cites: [] });
    // Fold all cites onto the intro paragraph so the UI can render them together
    paras[0].cites = cites;
  }

  return { title: 'Signals — Why now', paragraphs: paras };
}

// ─── Section: Fit thesis — Why ESDS ───────────────

function fitThesis(rec) {
  const recos = recommendForCompany(rec, 15).slice(0, 3);
  const paras = [];

  if (recos.length === 0) {
    paras.push({ text: 'No ESDS product meets the confidence threshold on the current data. Enrich the record or expand product catalog triggers.', cites: [] });
    return { title: 'Fit thesis — Why ESDS', paragraphs: paras };
  }

  paras.push({
    text: `The top ${recos.length} ESDS product${recos.length > 1 ? 's' : ''} that map to this account's profile:`,
    cites: [],
  });

  for (const r of recos) {
    const p = r.product;
    const line = `${p.name} (score ${r.score}, ${r.priority} priority) — ${p.tagline}.`;
    paras.push({
      text: line,
      cites: [
        cite('Trigger', r.reasons[0] || '—'),
        cite('Complexity', r.complexity),
        cite('Timeline', r.timeline),
      ],
    });
  }

  return { title: 'Fit thesis — Why ESDS', paragraphs: paras };
}

// ─── Section: Approach ────────────────────────────

function approach(rec, score) {
  const paras = [];
  let stance;
  if (score >= 65)      stance = 'top-priority — pursue this quarter';
  else if (score >= 40) stance = 'warm — schedule structured discovery in the next 4-6 weeks';
  else                   stance = 'nurture — monitor for signal changes, no active outreach recommended';

  paras.push({
    text: `Overall stance: ${stance}. Opportunity score is ${score}/100, with confidence ${confidenceScore(rec)}% (data completeness).`,
    cites: [cite('Score', score + '/100'), cite('Confidence', confidenceScore(rec) + '%')],
  });

  const steps = [];
  if (score >= 40) {
    if (rec.ceo || rec.cto || rec.cio) {
      const target = rec.cio || rec.cto || rec.ceo;
      steps.push(`Open a warm approach to ${target} on the ESDS product(s) with the highest fit score`);
    } else {
      steps.push('Identify the IT decision-maker via LinkedIn / peer network');
    }
    if (rec.painPoints)     steps.push('Anchor the discovery call to the pain points already on file');
    if (rec.initiatives)    steps.push('Cross-reference published initiatives with the top-fit product roadmap');
    if (rec.buyingPotential) steps.push('Prepare a business case sized to the estimated ₹' + rec.buyingPotential + ' Cr/yr wallet');
  } else {
    steps.push('Set a 90-day watchlist trigger — refresh maturity scores');
    steps.push('If a peer account in the same sector closes, flag this record for re-evaluation');
  }

  if (steps.length) {
    paras.push({ text: 'Recommended next steps:', cites: [] });
    for (const s of steps) paras.push({ text: '→ ' + s, cites: [] });
  }

  return { title: 'Approach', paragraphs: paras };
}

// ─── Public API ───────────────────────────────────

export function generateBrief(rec) {
  if (!rec) return { sections: [], talkingPoints: [], nextActions: [] };
  const { total } = opportunityScore(rec);

  const sections = [
    situation(rec),
    signals(rec),
    fitThesis(rec),
    approach(rec, total),
  ];

  const talkingPoints = buildTalkingPoints(rec);
  const nextActions   = buildNextActions(rec, total);

  return { sections, talkingPoints, nextActions, score: total };
}

function buildTalkingPoints(rec) {
  const out = [];
  if (rec.painPoints) out.push(`Acknowledge documented pain points and share how ESDS has solved them at 2-3 peer institutions`);
  if (rec.cloudMaturity === 'Low')   out.push('Frame cloud modernization as a compliance + cost win (RBI/IRDAI + 30-45% TCO reduction on SWARAJ Cloud)');
  if (rec.cyberMaturity === 'Low')   out.push('Lead with the RBI cyber framework mandate — SOC + SIEM as one bundle');
  if (rec.aiReadiness   === 'Low')   out.push('Show one BFSI AI use case (fraud detection or credit decisioning) with an ESDS reference client');
  if (rec.buyingPotential)           out.push(`Size the pitch to the estimated ₹${rec.buyingPotential} Cr/yr wallet — anchor high`);
  if (rec.branchCount && rec.branchCount > 100) out.push('Highlight branch-level SD-WAN and edge compute (SWARAJ Hansa / Jatayoo)');
  return out.slice(0, 6);
}

function buildNextActions(rec, score) {
  const out = [];
  if (score >= 65) {
    out.push('Book a 30-minute intro call this week');
    out.push('Prepare a 2-slide business case anchored to the top-fit product');
    out.push('Loop in the SE lead for the sector');
  } else if (score >= 40) {
    out.push('Send a personalized outreach citing one specific pain point');
    out.push('Add to the sector nurture sequence');
    out.push('Schedule a re-scoring in 60 days');
  } else {
    out.push('Add to watchlist with a 90-day review');
    out.push('Enrich the record — leadership, tech stack, initiatives');
    out.push('Monitor sector-level signals for a change in posture');
  }
  return out;
}
