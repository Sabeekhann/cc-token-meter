import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWhatIf, WHAT_IF_TARGETS } from '../src/analytics/whatIf.js';
import { matchModelRow } from '../src/pricing/cost.js';

// Round-number pricing so assertions never depend on real Anthropic prices.
const TABLE = [
  { id: 'big', matchSubstrings: ['big'], inputPerMTok: 10, outputPerMTok: 50, effectiveFrom: null, effectiveUntil: null },
  { id: 'small', matchSubstrings: ['small'], inputPerMTok: 1, outputPerMTok: 5, effectiveFrom: null, effectiveUntil: null },
];
const TARGETS = [
  { model: 'model-big', label: 'Big' },
  { model: 'model-small', label: 'Small' },
];

const session = (overrides) => ({
  projectCwd: '/work/alpha',
  inputTokens: 0,
  outputTokens: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  cacheReadInputTokens: 0,
  costUsd: 0,
  ...overrides,
});

test('buildWhatIf reprices identical tokens on each target model', () => {
  const sessions = [
    // 1M input + 1M output: $60 on Big, $6 on Small.
    session({ inputTokens: 1_000_000, outputTokens: 1_000_000, costUsd: 30 }),
    // 1M 5m cache writes (1.25x) + 1M 1h writes (2x) + 1M reads (0.1x) of input.
    session({ projectCwd: '/work/beta', cacheWrite5m: 1_000_000, cacheWrite1h: 1_000_000, cacheReadInputTokens: 1_000_000, costUsd: 3.35, estimatedCostUsed: true }),
  ];

  const result = buildWhatIf(sessions, { now: '2026-10-09T12:00:00.000Z', targets: TARGETS, pricingTable: TABLE });

  assert.equal(result.pricedAt, '2026-10-09T12:00:00.000Z');
  assert.deepEqual(result.targets, TARGETS);
  assert.ok(Math.abs(result.scope.actualCostUsd - 33.35) < 1e-9);
  assert.equal(result.scope.estimated, true);
  const [big, small] = result.scope.costs;
  assert.ok(Math.abs(big.costUsd - (60 + 33.5)) < 1e-9);
  assert.ok(Math.abs(small.costUsd - (6 + 3.35)) < 1e-9);
  assert.ok(Math.abs(small.deltaUsd - (9.35 - 33.35)) < 1e-9);
  assert.ok(Math.abs(small.deltaRatio - (9.35 - 33.35) / 33.35) < 1e-9);

  assert.deepEqual(result.byProject.map((p) => p.project), ['/work/alpha', '/work/beta'], 'sorted by actual cost');
  assert.equal(result.byProject[0].estimated, false);
  assert.ok(Math.abs(result.byProject[1].costs[1].costUsd - 3.35) < 1e-9);
  assert.ok(Math.abs(result.byProject[1].costs[1].deltaUsd) < 1e-9, 'same model, same price');
});

test('buildWhatIf handles empty scopes without dividing by zero', () => {
  const result = buildWhatIf([], { targets: TARGETS, pricingTable: TABLE });
  assert.equal(result.scope.actualCostUsd, 0);
  assert.ok(result.scope.costs.every((cost) => cost.costUsd === 0 && cost.deltaRatio === null));
  assert.deepEqual(result.byProject, []);
});

test('default what-if targets map to recognized pricing rows, never the fallback', () => {
  for (const target of WHAT_IF_TARGETS) {
    assert.equal(matchModelRow(target.model, new Date().toISOString()).estimated, false, target.model);
  }
});
