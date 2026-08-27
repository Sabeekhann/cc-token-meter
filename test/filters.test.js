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
  const usageRecords = Object.prototype.hasOwnProperty.call(overrides, 'usageRecords')
    ? overrides.usageRecords
    : [
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
  const dailyRollups = overrides.dailyRollups || [];
  const firstUnit = usageRecords[0] || dailyRollups[0] || null;
  const lastUnit = usageRecords[usageRecords.length - 1] || dailyRollups[dailyRollups.length - 1] || null;
  return {
    sessionId: 'session-1',
    projectCwd: '/work/alpha',
    projectDirNameFallback: null,
    models: ['claude-sonnet-5'],
    firstTimestamp: firstUnit?.firstTimestamp || firstUnit?.timestamp || null,
    lastTimestamp: lastUnit?.lastTimestamp || lastUnit?.timestamp || null,
    messageCount: 2,
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
    dailyRollups,
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

test('model filtering is exact, case-insensitive, and rebuilds mixed-model totals', () => {
  const mixed = session({
    models: ['claude-sonnet-5', 'claude-opus-4-1'],
    usageRecords: [
      record('2026-08-01T12:00:00.000Z'),
      record('2026-08-02T12:00:00.000Z', {
        model: 'claude-opus-4-1',
        inputTokens: 500,
        outputTokens: 100,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 50,
        costUsd: 0.05,
        gitBranch: 'feature/opus',
      }),
    ],
  });

  const filtered = filterSessions([mixed], { model: 'CLAUDE-OPUS-4-1' });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].messageCount, 1);
  assert.equal(filtered[0].inputTokens, 500);
  assert.equal(filtered[0].outputTokens, 100);
  assert.equal(filtered[0].cacheReadInputTokens, 50);
  assert.equal(filtered[0].costUsd, 0.05);
  assert.deepEqual(filtered[0].models, ['claude-opus-4-1']);
  assert.equal(filtered[0].gitBranch, 'feature/opus');
  assert.deepEqual(filtered[0].toolEvents, []);

  assert.deepEqual(filterSessions([mixed], { model: 'opus' }), []);
  assert.equal(mixed.messageCount, 2);
});

test('model filtering remains exact over compacted historical rollups', () => {
  const compacted = session({
    models: ['claude-sonnet-5', 'claude-opus-4-1'],
    dailyRollups: [
      {
        date: '2026-07-01',
        model: 'claude-opus-4-1',
        gitBranch: 'release/v1',
        version: '2.0.0',
        firstTimestamp: '2026-07-01T10:00:00.000Z',
        lastTimestamp: '2026-07-01T11:00:00.000Z',
        messageCount: 4,
        inputTokens: 400,
        outputTokens: 80,
        cacheCreationInputTokens: 40,
        cacheReadInputTokens: 120,
        cacheWrite5m: 0,
        cacheWrite1h: 0,
        costUsd: 0.04,
        estimatedCostUsed: true,
      },
    ],
    usageRecords: [record('2026-08-01T12:00:00.000Z')],
  });

  const filtered = filterSessions([compacted], {
    from: '2026-07-01',
    to: '2026-07-31',
    model: 'claude-opus-4-1',
  });

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].messageCount, 4);
  assert.equal(filtered[0].inputTokens, 400);
  assert.equal(filtered[0].costUsd, 0.04);
  assert.equal(filtered[0].estimatedCostUsed, true);
  assert.equal(filtered[0].dailyRollups.length, 1);
  assert.equal(filtered[0].usageRecords.length, 0);
  assert.deepEqual(filtered[0].models, ['claude-opus-4-1']);
});

test('model, date, and project filters compose without mutating canonical state', () => {
  const alpha = session({
    models: ['claude-sonnet-5', 'claude-opus-4-1'],
    usageRecords: [
      record('2026-08-01T12:00:00.000Z'),
      record('2026-08-03T12:00:00.000Z', { model: 'claude-opus-4-1', costUsd: 0.03 }),
    ],
  });
  const beta = session({
    sessionId: 'session-2',
    projectCwd: '/work/beta',
    models: ['claude-opus-4-1'],
    usageRecords: [record('2026-08-03T12:00:00.000Z', {
      sessionId: 'session-2',
      projectCwd: '/work/beta',
      model: 'claude-opus-4-1',
    })],
  });

  const filtered = filterSessions([alpha, beta], {
    from: '2026-08-03',
    to: '2026-08-03',
    project: 'alpha',
    model: 'claude-opus-4-1',
  });

  assert.deepEqual(filtered.map((item) => item.sessionId), ['session-1']);
  assert.equal(filtered[0].messageCount, 1);
  assert.equal(filtered[0].costUsd, 0.03);
  assert.equal(alpha.usageRecords.length, 2);
  assert.equal(beta.usageRecords.length, 1);
});

test('summary exposes normalized filters and a filtered message count', () => {
  const store = {
    getSnapshot() {
      return { sessions: [session()], totalIngestedMessages: 99 };
    },
  };
  const summary = buildSummary(store, {
    filters: { from: '2026-08-02', project: ' alpha ', model: ' claude-sonnet-5 ' },
    config: {
      dailyTokenCap: null,
      dailyCostCapUsd: null,
      sessionTokenCap: null,
      sessionCostCapUsd: null,
      warnThresholdPct: 80,
    },
  });

  assert.deepEqual(summary.filters, {
    from: '2026-08-02',
    to: null,
    project: 'alpha',
    model: 'claude-sonnet-5',
  });
  assert.equal(summary.totalIngestedMessages, 1);
  assert.equal(summary.sessions[0].messageCount, 1);
  assert.equal(summary.byDay.length, 1);
  assert.equal(summary.byDay[0].date, '2026-08-02');
});

test('summary does not reuse heuristic results across equal-sized date scopes', () => {
  const scopedSession = session({
    messageCount: 6,
    compactDetected: false,
    usageRecords: [
      record('2026-08-01T12:00:00.000Z'),
      record('2026-08-01T12:01:00.000Z'),
      record('2026-08-01T12:02:00.000Z'),
      record('2026-08-02T12:00:00.000Z'),
      record('2026-08-02T12:01:00.000Z'),
      record('2026-08-02T12:02:00.000Z'),
    ],
    toolEvents: [
      { kind: 'tool_use', name: 'Read', filePath: '/work/a.js', timestamp: '2026-08-01T12:00:01.000Z' },
      { kind: 'tool_use', name: 'Read', filePath: '/work/a.js', timestamp: '2026-08-01T12:01:01.000Z' },
      { kind: 'tool_use', name: 'Read', filePath: '/work/a.js', timestamp: '2026-08-01T12:02:01.000Z' },
      { kind: 'tool_use', name: 'Read', filePath: '/work/a.js', timestamp: '2026-08-02T12:00:01.000Z' },
      { kind: 'tool_use', name: 'Edit', filePath: '/work/a.js', timestamp: '2026-08-02T12:01:01.000Z' },
      { kind: 'tool_use', name: 'Read', filePath: '/work/a.js', timestamp: '2026-08-02T12:02:01.000Z' },
    ],
  });
  const store = {
    getSnapshot() {
      return { revision: 1, sessions: [scopedSession], totalIngestedMessages: 6 };
    },
  };
  const config = {
    dailyTokenCap: null,
    dailyCostCapUsd: null,
    sessionTokenCap: null,
    sessionCostCapUsd: null,
    warnThresholdPct: 80,
  };

  const firstDay = buildSummary(store, {
    filters: { from: '2026-08-01', to: '2026-08-01' },
    config,
  });
  const secondDay = buildSummary(store, {
    filters: { from: '2026-08-02', to: '2026-08-02' },
    config,
  });

  assert.ok(firstDay.tips.some((tip) => tip.id.startsWith('repeatedReads:')));
  assert.equal(secondDay.tips.some((tip) => tip.id.startsWith('repeatedReads:')), false);
});

test('filter normalization uses explicit nulls for reproducible JSON output', () => {
  assert.deepEqual(normalizeSummaryFilters({}), {
    from: null,
    to: null,
    project: null,
    model: null,
  });
  assert.deepEqual(normalizeSummaryFilters({ project: '   ', model: '   ' }), {
    from: null,
    to: null,
    project: null,
    model: null,
  });
});
