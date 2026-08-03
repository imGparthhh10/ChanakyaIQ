/**
 * meetingPrep.js — One-click sales meeting brief generator.
 *
 * Produces a printable meeting-prep document for a single company:
 *   - Elevator pitch (30-sec context)
 *   - Discovery questions (3 tiers: cheap wins → deep dive)
 *   - Talking points anchored to observed pain × ESDS fit
 *   - Objection handling for likely pushback
 *   - Recommended next-step commitments
 *
 * Rendered as a modal from Company 360. The output is print-optimized
 * so users can Print → PDF straight to the CRM. When a real LLM is
 * wired in, replace `generatePrep()` — every consumer keeps working.
 */

import { recommendForCompany }  from '../recommendations/engine.js';
import { opportunityScore }     from '../workspace/scoring.js';
import { deriveSignalTypes }    from '../workspace/signals.js';

const OBJECTION_LIBRARY = {
  price: {
    trigger: /price|budget|cost|expensive/i,
    prompt:  'Cost concern',
    response: 'Anchor to 3-year TCO vs on-premises or hyperscaler. ESDS delivers 30-45% lower TCO for BFSI workloads with sovereign compliance built in. Offer a proof-of-value at fixed scope.',
  },
  sovereignty: {
    trigger: /aws|azure|gcp|hyperscaler|foreign/i,
    prompt:  'Already on a hyperscaler',
    response: 'Position ESDS SWARAJ as a complement, not a replacement: data-residency-sensitive workloads (KYC, customer PII, RBI-regulated systems) on SWARAJ; internal apps stay where they are. Hybrid works well for BFSI.',
  },
  timing: {
    trigger: /later|next year|not ready|planning phase/i,
    prompt:  'Wrong timing',
    response: 'Convert to a lightweight assessment engagement — cloud readiness audit or cyber posture review. Small commitment, no procurement burden, keeps ESDS in the buying journey.',
  },
  compliance: {
    trigger: /rbi|irdai|sebi|compliance|regulator/i,
    prompt:  'Compliance concerns with cloud',
    response: 'ESDS is MeitY-empanelled and pre-certified for RBI, IRDAI, SEBI frameworks. Share the compliance dashboard and offer to walk their CISO through the audit trail.',
  },
  internal: {
    trigger: /in.?house|internal team|building it ourselves/i,
    prompt:  'Prefers in-house / internal team',
    response: 'Position ESDS managed services as a force multiplier — the internal team focuses on differentiating work while ESDS runs the plumbing. Reference the cost of building a 24/7 SOC from scratch.',
  },
};

// ─── Discovery ────────────────────────────────────

function discoveryQuestions(rec) {
  const quick = [
    'Walk me through the last cloud/security investment you shipped — what worked, what didn\'t?',
    'Where is IT budget being reallocated this fiscal year?',
    'How is your board thinking about digital transformation vs. cost pressure?',
  ];

  const medium = [];
  if (rec.cloudMaturity !== 'High') medium.push('What\'s holding back a broader cloud migration — regulatory, cost, skills, or lift-and-shift risk?');
  if (rec.cyberMaturity !== 'High') medium.push('If you had to rebuild your SOC + SIEM stack today, what would you do differently?');
  if (rec.aiReadiness   !== 'High') medium.push('Which BFSI workflows are on your AI shortlist — fraud, credit, customer analytics?');
  medium.push('How much of your infra runs on legacy platforms you\'d modernize if you could?');

  const deep = [
    'What are the top 3 initiatives on your CIO\'s roadmap for the next 12 months?',
    'Who else needs to sign off before a decision on a partner like ESDS?',
    'What does success look like 12 months after signing?',
  ];

  return { quick, medium, deep };
}

// ─── Talking points ───────────────────────────────

function talkingPoints(rec) {
  const points = [];
  const recos = recommendForCompany(rec, 15).slice(0, 3);

  if (rec.painPoints) {
    points.push({
      pain: 'Documented pain points on file',
      angle: `Lead with "We've solved this exact challenge for 2-3 peers in ${rec.category || 'BFSI'}." Have the reference client name ready.`,
    });
  }
  if (rec.cloudMaturity === 'Low' && recos.some(r => r.product.name.includes('SWARAJ Cloud'))) {
    points.push({
      pain: 'Low cloud maturity',
      angle: 'Frame SWARAJ Cloud as the sovereign path forward — compliance + TCO in one motion. Offer a cloud readiness assessment as the entry engagement.',
    });
  }
  if (rec.cyberMaturity === 'Low' && recos.some(r => /SOC|SIEM|Garuda/.test(r.product.name))) {
    points.push({
      pain: 'Low cyber maturity',
      angle: 'RBI cyber framework mandate is the wedge. Present the SOC + SIEM bundle with the 24/7 outcome vs the cost of building it in-house.',
    });
  }
  if (rec.aiReadiness === 'Low' && recos.some(r => r.product.name.includes('Bodhi'))) {
    points.push({
      pain: 'Low AI readiness',
      angle: 'Show one BFSI AI use case (fraud detection or credit decisioning) with an ESDS reference client. Skip generic AI pitch.',
    });
  }
  if (rec.buyingPotential) {
    points.push({
      pain: `Estimated ₹${rec.buyingPotential} Cr/yr wallet`,
      angle: 'Anchor pricing high — the buyer\'s expectation should be a strategic investment, not a line item. Come with a 3-phase land + expand plan.',
    });
  }
  return points.slice(0, 5);
}

// ─── Objections ───────────────────────────────────

function likelyObjections(rec) {
  const notesBlob = [rec.painPoints, rec.initiatives, rec.notes, rec.esdsFitNotes].filter(Boolean).join(' ');

  // Score each objection by trigger keyword presence in the record notes;
  // supplement with sector defaults so we always return 3+ objections.
  const scored = Object.values(OBJECTION_LIBRARY).map(o => ({
    ...o,
    score: (o.trigger.test(notesBlob) ? 3 : 0) + (o.trigger.test(rec.category || '') ? 1 : 0),
  })).sort((a, b) => b.score - a.score);

  // Always include price + compliance for BFSI meetings
  const must = ['price', 'compliance'];
  const out = [];
  for (const k of must) out.push(OBJECTION_LIBRARY[k]);
  for (const o of scored) {
    if (out.length >= 4) break;
    if (!out.includes(o) && !must.includes(Object.keys(OBJECTION_LIBRARY).find(k => OBJECTION_LIBRARY[k] === o))) {
      out.push(o);
    }
  }
  return out.slice(0, 4);
}

// ─── Elevator ─────────────────────────────────────

function elevator(rec) {
  const bits = [];
  if (rec.category) bits.push(rec.category);
  if (rec.state)    bits.push(`in ${rec.state}`);
  const scale = rec.revenue ? `₹${Math.round(rec.revenue)} Cr revenue` : (rec.employeeCount ? `${Number(rec.employeeCount).toLocaleString('en-IN')} employees` : null);
  if (scale)        bits.push(scale);
  const identity = bits.join(' · ');

  const types = deriveSignalTypes(rec);
  const drivers = [];
  if (types.has('buying'))     drivers.push(`₹${rec.buyingPotential} Cr/yr addressable wallet`);
  if (types.has('gap'))        drivers.push('modernization runway');
  if (types.has('risk'))       drivers.push('cyber uplift opportunity');
  if (types.has('initiative')) drivers.push('active initiatives');

  const line = drivers.length
    ? `${rec.companyName} — ${identity}. Why this meeting matters: ${drivers.join(', ')}.`
    : `${rec.companyName} — ${identity}. Discovery meeting: qualify fit and surface priorities.`;
  return line;
}

// ─── Public API ───────────────────────────────────

export function generatePrep(rec) {
  if (!rec) return null;
  const { total: score, drivers } = opportunityScore(rec);
  const recos = recommendForCompany(rec, 15).slice(0, 3);

  return {
    elevator:  elevator(rec),
    score,
    scoreDrivers: drivers,
    topProducts: recos.map(r => ({
      name: r.product.name,
      score: r.score,
      priority: r.priority,
      tagline: r.product.tagline,
      timeline: r.timeline,
    })),
    discovery: discoveryQuestions(rec),
    talkingPoints: talkingPoints(rec),
    objections: likelyObjections(rec),
    nextSteps: buildNextSteps(rec, score),
  };
}

function buildNextSteps(rec, score) {
  const steps = [];
  if (score >= 65) {
    steps.push('Commit to a follow-up within 5 business days with a tailored business case');
    steps.push('Ask for an introduction to a peer stakeholder (CISO / CFO / Head IT)');
    steps.push('Propose a paid proof-of-value on the top-fit product');
  } else if (score >= 40) {
    steps.push('Send a personalized recap within 24 hours citing one specific point they raised');
    steps.push('Offer a cloud readiness OR cyber posture assessment as low-friction next step');
    steps.push('Schedule a 30-day follow-up');
  } else {
    steps.push('Add to sector nurture sequence');
    steps.push('Schedule a re-scoring review in 60 days');
    steps.push('Ask permission to share a monthly BFSI intelligence digest');
  }
  return steps;
}
