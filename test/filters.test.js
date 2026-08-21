import assert from 'node:assert/strict';
import test from 'node:test';
import { filterSessions, normalizeSummaryFilters } from '../src/analytics/filters.js';
import { buildSummary } from '../src/server/summary.js';

function record(timestamp, overrides = {}) {
  return {
    timestamp,
    sessionId: 'session-1',
    projectCwd: '/work/alpha',
    gitBranch: 'main',
    version: '2.1.0',
    model: 'claude-sonnet-5',
    inputTokens: 100,
    outputTokens: 20,
    cacheCreationInputTokens: 10,
    cacheReadInputTokens: 30,
    cacheWrite5m: 10,
    cacheWrite1h: 0,
    costUsd: 0.01,
    estimatedCostUsed: false,
    ...overrides,
  };
}

function session(overrides = {}) {
  const usageRecords = overrides.usageRecords || [
    record('2026-08-01T12:00:00.000Z'),
    record('2026-08-02T12:00:00.000Z', {
      inputTokens: 200,
      outputTokens: 40,
      cacheCreationInputTokens: 20,
      cacheReadInputTokens: 60,
      cacheWrite5m: 0,
      cacheWrite1h: 20,
      costUsd: 0.02,
      gitBranch: 'feature/export',
    }),
  ];
  return {
    sessionId: 'session-1',
    projectCwd: '/work/alpha',
    projectDirNameFallback: null,
    models: ['claude-sonnet-5'],
    firstTimestamp: usageRecords[0].timestamp,
    lastTimestamp: usageRecords[usageRecords.length - 1].timestamp,
    messageCount: usageRecords.length,
    inputTokens: 300,
    outputTokens: 60,
    cacheCreationInputTokens: 30,
    cacheReadInputTokens: 90,
    cacheWrite5m: 10,
    cacheWrite1h: 20,
    costUsd: 0.03,
    estimatedCostUsed: false,
    gitBranch: 'feature/export',
    version: '2.1.0',
    usageRecords,
    toolEvents: [
      { kind: 'tool_use', name: 'Read', timestamp: '2026-08-01T12:00:01.000Z' },
      { kind: 'tool_use', name: 'Grep', timestamp: '2026-08-02T12:00:01.000Z' },
    ],
    ...overrides,
  };
}

test('date filtering rebuilds exact session totals and correlated tools', () => {
  const filtered = filterSessions([session()], { from: '2026-08-02', to: '2026-08-02' });

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].messageCount, 1);
  assert.equal(filtered[0].inputTokens, 200);
  assert.equal(filtered[0].outputTokens, 40);
  assert.equal(filtered[0].cacheCreationInputTokens, 20);
  assert.equal(filtered[0].cacheReadInputTokens, 60);
  assert.equal(filtered[0].costUsd, 0.02);
  assert.equal(filtered[0].gitBranch, 'feature/export');
  assert.equal(filtered[0].toolEvents.length, 1);
  assert.equal(filtered[0].toolEvents[0].name, 'Grep');
});

test('project filtering is case-insensitive and leaves canonical sessions untouched', () => {
  const alpha = session();
  const beta = session({
    sessionId: 'session-2',
    projectCwd: '/work/Beta-App',
    usageRecords: [record('2026-08-02T12:00:00.000Z', { sessionId: 'session-2', projectCwd: '/work/Beta-App' })],
  });

  const filtered = filterSessions([alpha, beta], { project: 'beta' });
  assert.deepEqual(filtered.map((item) => item.sessionId), ['session-2']);
  assert.equal(alpha.messageCount, 2);
});

test('summary exposes normalized filters and a filtered message count', () => {
  const store = {
    getSnapshot() {
      return { sessions: [session()], totalIngestedMessages: 99 };
    },
  };
  const summary = buildSummary(store, {
    filters: { from: '2026-08-02', project: ' alpha ' },
    config: {
      dailyTokenCap: null,
      dailyCostCapUsd: null,
      sessionTokenCap: null,
      sessionCostCapUsd: null,
      warnThresholdPct: 80,
    },
  });

  assert.deepEqual(summary.filters, { from: '2026-08-02', to: null, project: 'alpha' });
  assert.equal(summary.totalIngestedMessages, 1);
  assert.equal(summary.sessions[0].messageCount, 1);
  assert.equal(summary.byDay.length, 1);
  assert.equal(summary.byDay[0].date, '2026-08-02');
});

test('filter normalization uses explicit nulls for reproducible JSON output', () => {
  assert.deepEqual(normalizeSummaryFilters({}), { from: null, to: null, project: null });
  assert.deepEqual(normalizeSummaryFilters({ project: '   ' }), { from: null, to: null, project: null });
});
