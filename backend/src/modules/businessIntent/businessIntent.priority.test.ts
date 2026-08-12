import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeFinalPriority } from './businessIntent.priority';

test('Strategic tier + Qualified -> Hot', () => {
  assert.equal(computeFinalPriority('Qualified', 'Strategic'), 'Hot -- top priority');
});

test('Strategic tier + Watch -> High potential', () => {
  assert.equal(computeFinalPriority('Watch', 'Strategic'), 'High potential, needs nurturing');
});

test('Strategic tier + Not Qualified -> outbound trigger candidate', () => {
  assert.equal(computeFinalPriority('Not Qualified', 'Strategic'), 'Strategic fit, no signal yet -- outbound trigger candidate');
});

test('Tier 2 + Qualified -> Signal-driven', () => {
  assert.equal(computeFinalPriority('Qualified', 'Tier 2'), 'Signal-driven -- worth pursuing despite lower ICP fit');
});

test('Tier 3 + Watch -> Moderate', () => {
  assert.equal(computeFinalPriority('Watch', 'Tier 3'), 'Moderate -- monitor');
});

test('Watchlist tier + Not Qualified -> Deprioritize', () => {
  assert.equal(computeFinalPriority('Not Qualified', 'Watchlist'), 'Deprioritize');
});

test('no ICP tier at all (null) falls into the Tier2/3 bucket, not Strategic', () => {
  assert.equal(computeFinalPriority('Qualified', null), 'Signal-driven -- worth pursuing despite lower ICP fit');
  assert.equal(computeFinalPriority('Not Qualified', null), 'Deprioritize');
});
