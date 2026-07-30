import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCost, matchModelRow } from '../src/pricing/cost.js';

// Test-only pricing table with small round numbers so these tests don't
// need updating when real Anthropic prices change.
const FAKE_TABLE = [
  {
    id: 'fake-a-old',
    matchSubstrings: ['fakemodel-a'],
    inputPerMTok: 10, // $10/MTok => $0.00001/token
    outputPerMTok: 20,
    effectiveFrom: null,
    effectiveUntil: '2026-06-01T00:00:00.000Z',
  },
  {
    id: 'fake-a-new',
    matchSubstrings: ['fakemodel-a'],
    inputPerMTok: 100,
    outputPerMTok: 200,
    effectiveFrom: '2026-06-01T00:00:00.000Z',
    effectiveUntil: null,
  },
  {
    id: 'fake-b',
    matchSubstrings: ['fakemodel-b'],
    inputPerMTok: 1,
    outputPerMTok: 2,
    effectiveFrom: null,
    effectiveUntil: null,
  },
];

test('matchModelRow picks the row whose date range contains the timestamp', () => {
  const before = matchModelRow('claude-fakemodel-a-20260101', '2026-05-01T00:00:00.000Z', FAKE_TABLE);
  assert.equal(before.row.id, 'fake-a-old');
  assert.equal(before.estimated, false);

  const after = matchModelRow('claude-fakemodel-a-20260601', '2026-07-01T00:00:00.000Z', FAKE_TABLE);
  assert.equal(after.row.id, 'fake-a-new');

  // Exactly at the boundary — effectiveFrom is inclusive for the new row.
  const atBoundary = matchModelRow('claude-fakemodel-a', '2026-06-01T00:00:00.000Z', FAKE_TABLE);
  assert.equal(atBoundary.row.id, 'fake-a-new');
});

test('matchModelRow matches by substring, not exact equality', () => {
  const result = matchModelRow('claude-fakemodel-b-20261231-v3', '2026-01-01T00:00:00.000Z', FAKE_TABLE);
  assert.equal(result.row.id, 'fake-b');
});

test('matchModelRow falls back and flags estimated:true for unknown models', () => {
  const result = matchModelRow('some-totally-unknown-model', '2026-01-01T00:00:00.000Z', FAKE_TABLE);
  assert.equal(result.estimated, true);
});

test('computeCost applies base input/output rates correctly with fake table', () => {
  const record = {
    model: 'claude-fakemodel-b',
    timestamp: '2026-01-01T00:00:00.000Z',
    inputTokens: 1_000_000,
    outputTokens: 500_000,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    cacheReadInputTokens: 0,
  };
  const cost = computeCost(record, FAKE_TABLE);
  // fake-b: $1/MTok input, $2/MTok output
  assert.equal(cost.inputCost, 1); // 1,000,000 tokens * $1/1e6
  assert.equal(cost.outputCost, 1); // 500,000 tokens * $2/1e6
  assert.equal(cost.totalCost, 2);
  assert.equal(cost.estimated, false);
});

test('computeCost applies cache multipliers correctly (1.25x, 2x, 0.1x of base input)', () => {
  const record = {
    model: 'claude-fakemodel-b', // base input rate = $1/MTok
    timestamp: '2026-01-01T00:00:00.000Z',
    inputTokens: 0,
    outputTokens: 0,
    cacheWrite5m: 1_000_000,
    cacheWrite1h: 1_000_000,
    cacheReadInputTokens: 1_000_000,
  };
  const cost = computeCost(record, FAKE_TABLE);

  // Use approximate comparisons — floating point division/multiplication
  // (e.g. 1,000,000 * (1/1_000_000) * 0.1) doesn't always land on an exact
  // binary-representable value like 0.1.
  assertApprox(cost.cacheWrite5mCost, 1.25); // 1.25x of $1/MTok base
  assertApprox(cost.cacheWrite1hCost, 2.0); // 2x of $1/MTok base
  assertApprox(cost.cacheReadCost, 0.1); // 0.1x of $1/MTok base
  assertApprox(cost.totalCost, 1.25 + 2.0 + 0.1);
});

function assertApprox(actual, expected, epsilon = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) < epsilon,
    `expected ${actual} to be approximately ${expected}`
  );
}

test('computeCost marks estimated:true and uses fallback pricing for unmatched models', () => {
  const record = {
    model: 'totally-unrecognized-model-xyz',
    timestamp: '2026-01-01T00:00:00.000Z',
    inputTokens: 1_000_000,
    outputTokens: 0,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    cacheReadInputTokens: 0,
  };
  const cost = computeCost(record, FAKE_TABLE);
  assert.equal(cost.estimated, true);
  // Falls back to the built-in FALLBACK_ROW (real pricing table's
  // fallback), not one of the fake rows — just assert it's a positive,
  // finite number so this test isn't tied to real pricing values.
  assert.ok(Number.isFinite(cost.totalCost));
  assert.ok(cost.totalCost > 0);
});
