import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeBusinessIntent, QUALIFIED_THRESHOLD, WATCH_THRESHOLD } from './businessIntent.scoring';
import type { BusinessIntentOrgInput } from './businessIntent.types';

function baseOrg(overrides: Partial<BusinessIntentOrgInput> = {}): BusinessIntentOrgInput {
  return {
    organizationId: 'org-1',
    legalName: 'Test Bank Ltd',
    sectorName: 'BFSI',
    metrics: { revenue: null, itSpend: null, cloudSpend: null },
    technologyProfiles: [],
    leadershipDesignations: [],
    hasRecentDocumentActivity: false,
    ...overrides,
  };
}

test('excludes out-of-scope sectors before any scoring', () => {
  const result = computeBusinessIntent(baseOrg({ sectorName: 'Retail' }));
  assert.equal(result.excluded, true);
  assert.equal(result.exclusionReason, 'Outside ICP scope');
  assert.equal(result.classification, 'Not Qualified');
  assert.equal(result.score, 0);
});

test('missing economic buyer lowers the score but never excludes the org', () => {
  // Regression guard: this used to hard-exclude, which disqualified 250 of
  // 297 real organizations for a data-entry gap rather than a business
  // reason. Absent leadership must now simply not score the E letter.
  const noBuyer = computeBusinessIntent(
    baseOrg({ leadershipDesignations: ['Branch Manager'], metrics: { revenue: 500, itSpend: null, cloudSpend: null } }),
  );
  assert.equal(noBuyer.excluded, false);
  assert.equal(noBuyer.exclusionReason, null);
  assert.ok(!noBuyer.lettersMatched.includes('E'), 'E must not fire without a buyer');
  assert.equal(noBuyer.score, 15, 'scores M only');

  // ...and an otherwise-identical org WITH a buyer must outrank it.
  const withBuyer = computeBusinessIntent(
    baseOrg({ leadershipDesignations: ['CIO'], metrics: { revenue: 500, itSpend: null, cloudSpend: null } }),
  );
  assert.ok(withBuyer.score > noBuyer.score);
});

test('an org with no data at all scores 0 but is still not excluded', () => {
  const result = computeBusinessIntent(baseOrg());
  assert.equal(result.excluded, false);
  assert.equal(result.score, 0);
  assert.equal(result.classification, 'Not Qualified');
});

test('CFO counts as an economic buyer even though leadershipProfile has no cfoName column', () => {
  const result = computeBusinessIntent(baseOrg({ leadershipDesignations: ['CFO'] }));
  assert.equal(result.excluded, false);
  assert.ok(result.lettersMatched.includes('E'));
});

test('designation matching is case-insensitive', () => {
  const result = computeBusinessIntent(baseOrg({ leadershipDesignations: ['chairman'] }));
  assert.equal(result.excluded, false);
});

test('M letter is only counted once even when both M conditions fire (dedup via Set)', () => {
  const result = computeBusinessIntent(
    baseOrg({
      leadershipDesignations: ['CIO'],
      metrics: { revenue: 500, itSpend: null, cloudSpend: null }, // fires M via revenue
      technologyProfiles: [{ category: 'Cloud Adoption Level', valueText: 'Low' }], // fires M via tech pain
    }),
  );
  const mCount = result.lettersMatched.filter((l) => l === 'M').length;
  assert.equal(mCount, 1, 'M must appear exactly once in lettersMatched, not twice');
  // Both M conditions contribute their own 15 points each (score, not letter
  // count, reflects both firing) + E (15) = 45; breadth bonus needs 3
  // *distinct* letters, and only M+E are present here, so no bonus.
  assert.equal(result.score, 45);
  assert.deepEqual(result.lettersMatched.sort(), ['E', 'M']);
});

test('revenue threshold is evaluated in INR crore, not raw rupees', () => {
  // 500 Cr revenue should fire M; a value that would only fire under a
  // raw-rupee misinterpretation (e.g. 500 = Rs 500, nowhere near Rs 100 Cr)
  // must not.
  const fires = computeBusinessIntent(
    baseOrg({ leadershipDesignations: ['CTO'], metrics: { revenue: 150, itSpend: null, cloudSpend: null } }),
  );
  assert.ok(fires.lettersMatched.includes('M'));

  const doesNotFire = computeBusinessIntent(
    baseOrg({ leadershipDesignations: ['CTO'], metrics: { revenue: 50, itSpend: null, cloudSpend: null } }),
  );
  assert.ok(!doesNotFire.lettersMatched.includes('M'));
});

test('breadth bonus requires all 3 distinct letters (M, E, D_process)', () => {
  const withoutD = computeBusinessIntent(
    baseOrg({ leadershipDesignations: ['CIO'], metrics: { revenue: 200, itSpend: null, cloudSpend: null } }),
  );
  assert.equal(withoutD.score, 30); // M(15) + E(15), no bonus

  const withD = computeBusinessIntent(
    baseOrg({
      leadershipDesignations: ['CIO'],
      metrics: { revenue: 200, itSpend: null, cloudSpend: null },
      hasRecentDocumentActivity: true,
    }),
  );
  assert.equal(withD.score, 55); // M(15) + E(15) + D_process(10) + breadth bonus(15)
  assert.equal(withD.classification, 'Qualified');
});

test('classification thresholds: Qualified >= 40, Watch >= 20, else Not Qualified', () => {
  assert.equal(QUALIFIED_THRESHOLD, 40);
  assert.equal(WATCH_THRESHOLD, 20);

  // E only (buyer present, nothing else) = 15 -> below Watch -> Not Qualified
  const notQualified = computeBusinessIntent(baseOrg({ leadershipDesignations: ['CIO'] }));
  assert.equal(notQualified.score, 15);
  assert.equal(notQualified.classification, 'Not Qualified');

  // E + M = 30 -> Watch
  const watch = computeBusinessIntent(
    baseOrg({ leadershipDesignations: ['CIO'], metrics: { revenue: 200, itSpend: null, cloudSpend: null } }),
  );
  assert.equal(watch.classification, 'Watch');

  // E + M + D_process + bonus = 55 -> Qualified
  const qualified = computeBusinessIntent(
    baseOrg({
      leadershipDesignations: ['CIO'],
      metrics: { revenue: 200, itSpend: null, cloudSpend: null },
      hasRecentDocumentActivity: true,
    }),
  );
  assert.equal(qualified.classification, 'Qualified');
});

test('technology pain signal only fires on Low readings, not Medium/High', () => {
  const low = computeBusinessIntent(
    baseOrg({
      leadershipDesignations: ['CIO'],
      technologyProfiles: [{ category: 'Cybersecurity Maturity', valueText: 'Low' }],
    }),
  );
  assert.ok(low.lettersMatched.includes('M'));

  const medium = computeBusinessIntent(
    baseOrg({
      leadershipDesignations: ['CIO'],
      technologyProfiles: [{ category: 'Cybersecurity Maturity', valueText: 'Medium' }],
    }),
  );
  assert.ok(!medium.lettersMatched.includes('M'));
});

test('unrelated technology_profiles categories (e.g. AI Readiness) never fire the pain signal', () => {
  const result = computeBusinessIntent(
    baseOrg({
      leadershipDesignations: ['CIO'],
      technologyProfiles: [{ category: 'AI Readiness', valueText: 'Low' }],
    }),
  );
  assert.ok(!result.lettersMatched.includes('M'));
});
