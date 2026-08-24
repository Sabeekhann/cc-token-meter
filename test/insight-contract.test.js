import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertInsightContract,
  createInsight,
  rankAndDedupeInsights,
} from '../src/heuristics/contract.js';
import { repeatedReads } from '../src/heuristics/repeatedReads.js';
import { cacheRatio } from '../src/heuristics/cacheRatio.js';
import { longSessionNoCompact } from '../src/heuristics/longSessionNoCompact.js';
import { outlierSessionTotal } from '../src/heuristics/outlierSessionTotal.js';
import {
  largeToolResultSpike,
  LARGE_RESULT_BYTE_THRESHOLD,
} from '../src/heuristics/largeToolResultSpike.js';

function baseInsight(overrides = {}) {
  return createInsight({
    id: 'example',
    sessionId: 'session',
    severity: 'info',
    message: 'Measured signal found.',
    action: 'Take a concrete action.',
    scope: { type: 'session', id: 'session' },
    confidence: { level: 'high', score: 0.9, basis: 'Exact local counters.' },
    evidence: [{ metric: 'count', value: 1, unit: 'events', kind: 'measured' }],
    ...overrides,
  });
}

test('insight contract keeps legacy savings fields and omits unknowable structured savings', () => {
  const insight = baseInsight();
  assert.equal(insight.estimatedSavingsTokens, null);
  assert.equal(insight.estimatedSavingsUsd, null);
  assert.equal('savings' in insight, false);
  assert.equal(assertInsightContract(insight), insight);
});

test('insight contract labels calculable savings as estimates with a basis', () => {
  const insight = baseInsight({
    savings: { kind: 'estimated', tokens: 200, usd: 0.01, basis: 'Measured bytes divided by four.' },
  });
  assert.equal(insight.savings.kind, 'estimated');
  assert.equal(insight.estimatedSavingsTokens, 200);
  assert.equal(insight.estimatedSavingsUsd, 0.01);
});

test('rank and dedupe is deterministic for duplicate scope/action insights', () => {
  const low = baseInsight({ id: 'low', confidence: { level: 'low', score: 0.3, basis: 'Weak signal.' } });
  const high = baseInsight({
    id: 'high',
    severity: 'warn',
    confidence: { level: 'high', score: 0.95, basis: 'Exact signal.' },
  });
  const other = baseInsight({ id: 'other', action: 'Take a different action.' });
  assert.deepEqual(rankAndDedupeInsights([low, other, high]).map((item) => item.id), ['high', 'other']);
});

test('all heuristics emit the shared evidence, confidence, action, and scope contract', () => {
  const repeated = repeatedReads(
    { sessionId: 'reads', usageRecords: [{ inputTokens: 100 }] },
    [1, 2, 3].map((second) => ({
      kind: 'tool_use',
      name: 'Read',
      filePath: '/tmp/a.js',
      timestamp: `2026-01-01T00:00:0${second}.000Z`,
    }))
  )[0];

  const cacheRecords = Array.from({ length: 20 }, (_, index) => ({
    timestamp: `2026-01-01T00:00:${String(index).padStart(2, '0')}.000Z`,
    cacheCreationInputTokens: index < 15 ? 10 : 20,
    cacheReadInputTokens: 100,
  }));
  const cache = cacheRatio({ sessionId: 'cache', usageRecords: cacheRecords })[0];
  const long = longSessionNoCompact({ sessionId: 'long', messageCount: 60 }, [], [], [])[0];
  const history = [100, 200, 300, 400, 500].map((value, index) => ({
    sessionId: `history-${index}`,
    inputTokens: value,
  }));
  const outlier = outlierSessionTotal({ sessionId: 'outlier', inputTokens: 501, costUsd: 0 }, [], history)[0];

  const usageRecords = Array.from({ length: 10 }, (_, index) => ({
    timestamp: `2026-01-01T00:00:0${index}.000Z`,
    outputTokens: index === 9 ? 1000 : 10,
  }));
  const spike = largeToolResultSpike(
    { sessionId: 'spike', usageRecords },
    [
      { kind: 'tool_use', name: 'Read', toolUseId: 'tool', timestamp: '2026-01-01T00:00:08.100Z' },
      {
        kind: 'tool_result',
        toolUseId: 'tool',
        contentByteLength: LARGE_RESULT_BYTE_THRESHOLD + 4,
        timestamp: '2026-01-01T00:00:08.500Z',
      },
    ]
  )[0];

  for (const insight of [repeated, cache, long, outlier, spike]) {
    assertInsightContract(insight);
    assert.ok(insight.action.length > 0);
    assert.ok(insight.scope.id.length > 0);
    assert.ok(insight.evidence.every((item) => item.kind === 'measured' || item.kind === 'estimated'));
  }
});

test('heuristic boundaries are explicit and do not over-trigger', () => {
  const reads = (count) => Array.from({ length: count }, (_, index) => ({
    kind: 'tool_use',
    name: 'Read',
    filePath: '/tmp/b.js',
    timestamp: `2026-01-01T00:00:0${index}.000Z`,
  }));
  assert.equal(repeatedReads({ sessionId: 'r2' }, reads(2)).length, 0);
  assert.equal(repeatedReads({ sessionId: 'r3' }, reads(3)).length, 1);
  assert.equal(longSessionNoCompact({ sessionId: 'l59', messageCount: 59 }).length, 0);
  assert.equal(longSessionNoCompact({ sessionId: 'l60', messageCount: 60 }).length, 1);

  const history = [100, 200, 300, 400, 500].map((inputTokens, index) => ({
    sessionId: `h-${index}`,
    inputTokens,
  }));
  assert.equal(outlierSessionTotal({ sessionId: 'equal', inputTokens: 500 }, [], history).length, 0);
  assert.equal(outlierSessionTotal({ sessionId: 'above', inputTokens: 501 }, [], history).length, 1);

  const records = Array.from({ length: 10 }, (_, index) => ({
    timestamp: `2026-01-01T00:00:0${index}.000Z`,
    outputTokens: index === 9 ? 1000 : 10,
  }));
  const events = (bytes) => [
    { kind: 'tool_use', toolUseId: 'boundary', timestamp: '2026-01-01T00:00:08.100Z' },
    { kind: 'tool_result', toolUseId: 'boundary', contentByteLength: bytes, timestamp: '2026-01-01T00:00:08.500Z' },
  ];
  assert.equal(largeToolResultSpike({ sessionId: 'bytes-equal', usageRecords: records }, events(LARGE_RESULT_BYTE_THRESHOLD)).length, 0);
  assert.equal(largeToolResultSpike({ sessionId: 'bytes-above', usageRecords: records }, events(LARGE_RESULT_BYTE_THRESHOLD + 1)).length, 1);
});
