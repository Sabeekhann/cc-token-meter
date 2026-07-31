import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateByProject,
  aggregateByBranch,
  aggregateByDay,
  getTodayTotal,
  forecastBurnRate,
  buildTimeline,
} from '../src/ingest/aggregate.js';

function makeSession(overrides = {}) {
  return {
    sessionId: 's1',
    projectCwd: '/Users/dev/project-a',
    projectDirNameFallback: null,
    inputTokens: 100,
    outputTokens: 50,
    cacheCreationInputTokens: 10,
    cacheReadInputTokens: 5,
    costUsd: 0.5,
    messageCount: 1,
    lastTimestamp: '2026-07-30T10:00:00.000Z',
    usageRecords: [],
    ...overrides,
  };
}

test('aggregateByProject groups sessions and sums totals', () => {
  const sessions = [
    makeSession({ sessionId: 's1', projectCwd: '/proj/a', inputTokens: 100 }),
    makeSession({ sessionId: 's2', projectCwd: '/proj/a', inputTokens: 200 }),
    makeSession({ sessionId: 's3', projectCwd: '/proj/b', inputTokens: 50 }),
  ];

  const result = aggregateByProject(sessions);

  const projA = result.find((p) => p.project === '/proj/a');
  const projB = result.find((p) => p.project === '/proj/b');

  assert.ok(projA);
  assert.ok(projB);
  assert.equal(projA.sessions.length, 2);
  assert.equal(projA.inputTokens, 300);
  assert.equal(projB.inputTokens, 50);
});

test('aggregateByProject falls back to projectDirNameFallback when no cwd', () => {
  const sessions = [makeSession({ projectCwd: null, projectDirNameFallback: '/fallback/path' })];
  const result = aggregateByProject(sessions);
  assert.equal(result[0].project, '/fallback/path');
});

test('aggregateByBranch groups multiple sessions on the same branch and sums totals', () => {
  const sessions = [
    makeSession({ sessionId: 's1', gitBranch: 'feature/foo', inputTokens: 100, costUsd: 1 }),
    makeSession({ sessionId: 's2', gitBranch: 'feature/foo', inputTokens: 200, costUsd: 2 }),
  ];

  const result = aggregateByBranch(sessions);

  assert.equal(result.length, 1);
  assert.equal(result[0].branch, 'feature/foo');
  assert.equal(result[0].sessions.length, 2);
  assert.equal(result[0].inputTokens, 300);
  assert.equal(result[0].costUsd, 3);
});

test('aggregateByBranch keeps sessions on different branches separate', () => {
  const sessions = [
    makeSession({ sessionId: 's1', gitBranch: 'main', inputTokens: 100 }),
    makeSession({ sessionId: 's2', gitBranch: 'feature/bar', inputTokens: 50 }),
  ];

  const result = aggregateByBranch(sessions);

  const main = result.find((b) => b.branch === 'main');
  const feature = result.find((b) => b.branch === 'feature/bar');

  assert.ok(main);
  assert.ok(feature);
  assert.equal(main.sessions.length, 1);
  assert.equal(feature.sessions.length, 1);
  assert.equal(main.inputTokens, 100);
  assert.equal(feature.inputTokens, 50);
});

test('aggregateByBranch groups sessions with null/missing gitBranch under (no branch)', () => {
  const sessions = [
    makeSession({ sessionId: 's1', gitBranch: null, inputTokens: 10 }),
    makeSession({ sessionId: 's2', gitBranch: undefined, inputTokens: 20 }),
  ];

  const result = aggregateByBranch(sessions);

  assert.equal(result.length, 1);
  assert.equal(result[0].branch, '(no branch)');
  assert.equal(result[0].sessions.length, 2);
  assert.equal(result[0].inputTokens, 30);
});

test('aggregateByBranch handles a single session correctly', () => {
  const sessions = [makeSession({ sessionId: 's1', gitBranch: 'solo-branch', inputTokens: 42, costUsd: 0.42 })];

  const result = aggregateByBranch(sessions);

  assert.equal(result.length, 1);
  assert.equal(result[0].branch, 'solo-branch');
  assert.equal(result[0].sessions.length, 1);
  assert.equal(result[0].inputTokens, 42);
  assert.equal(result[0].costUsd, 0.42);
});

test('aggregateByBranch sorts buckets by tokenTotal descending', () => {
  const sessions = [
    makeSession({ sessionId: 's1', gitBranch: 'small', inputTokens: 10, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }),
    makeSession({ sessionId: 's2', gitBranch: 'big', inputTokens: 1000, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }),
    makeSession({ sessionId: 's3', gitBranch: 'medium', inputTokens: 100, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }),
  ];

  const result = aggregateByBranch(sessions);

  assert.deepEqual(result.map((b) => b.branch), ['big', 'medium', 'small']);
});

test('aggregateByDay buckets usageRecords by local calendar date, attributing per-message not per-session', () => {
  // A "session" whose usageRecords span local midnight: one message just
  // before midnight, one just after. Use explicit local-time construction
  // via a fixed pair of ISO timestamps 1 minute apart that straddle a
  // day boundary in UTC (test runs in whatever local TZ the CI/dev machine
  // uses — we verify relative behavior, not absolute dates).
  const dayBoundaryUtc = new Date();
  dayBoundaryUtc.setUTCHours(23, 59, 30, 0);
  const beforeMidnight = new Date(dayBoundaryUtc.getTime());
  const afterMidnight = new Date(dayBoundaryUtc.getTime() + 60_000); // +1 min, crosses UTC midnight

  const session = makeSession({
    sessionId: 's-midnight',
    messageCount: 2,
    costUsd: 2.0,
    usageRecords: [
      {
        timestamp: beforeMidnight.toISOString(),
        inputTokens: 100,
        outputTokens: 10,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      },
      {
        timestamp: afterMidnight.toISOString(),
        inputTokens: 200,
        outputTokens: 20,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      },
    ],
  });

  const days = aggregateByDay([session]);

  // The two messages should NOT both land in the same bucket if they cross
  // a local calendar date — but this depends on local TZ vs UTC offset.
  // What we can assert deterministically: total tokens across all buckets
  // equals the sum of both messages (no double-counting, no loss), and
  // each message's tokens appear whole in exactly one bucket (not split).
  const totalInput = days.reduce((sum, d) => sum + d.inputTokens, 0);
  assert.equal(totalInput, 300);

  // Every bucket's inputTokens must be one of the two individual message
  // values (100, 200) or their sum (300, if TZ offset keeps both on the
  // same local day) — never a fractional split.
  for (const d of days) {
    assert.ok([100, 200, 300].includes(d.inputTokens));
  }
});

test('aggregateByDay falls back to session-level lastTimestamp when usageRecords absent', () => {
  const session = makeSession({
    usageRecords: [],
    lastTimestamp: '2026-07-30T12:00:00.000Z',
    inputTokens: 500,
  });
  const days = aggregateByDay([session]);
  assert.equal(days.length, 1);
  assert.equal(days[0].inputTokens, 500);
});

test('getTodayTotal returns zeroed bucket when no sessions match today', () => {
  const session = makeSession({
    usageRecords: [
      {
        timestamp: '2020-01-01T00:00:00.000Z',
        inputTokens: 999,
        outputTokens: 1,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      },
    ],
  });
  const today = getTodayTotal([session]);
  assert.equal(today.inputTokens, 0);
  assert.equal(today.tokenTotal, 0);
});

test('getTodayTotal picks up a message timestamped right now', () => {
  const nowIso = new Date().toISOString();
  const session = makeSession({
    messageCount: 1,
    costUsd: 1.23,
    usageRecords: [
      {
        timestamp: nowIso,
        inputTokens: 42,
        outputTokens: 7,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      },
    ],
  });
  const today = getTodayTotal([session]);
  assert.equal(today.inputTokens, 42);
  assert.equal(today.outputTokens, 7);
});

test('forecastBurnRate returns zeroed defaults for zero days of history', () => {
  const forecast = forecastBurnRate([]);
  assert.equal(forecast.daysObserved, 0);
  assert.equal(forecast.avgDailyTokens, 0);
  assert.equal(forecast.avgDailyCostUsd, 0);
  assert.equal(forecast.projectedTokens, 0);
  assert.equal(forecast.projectedCostUsd, 0);
});

test('forecastBurnRate uses the single day available when history has only one entry', () => {
  const days = [{ date: '2026-07-30', tokenTotal: 1000, costUsd: 2 }];
  const forecast = forecastBurnRate(days);
  assert.equal(forecast.daysObserved, 1);
  assert.equal(forecast.avgDailyTokens, 1000);
  assert.equal(forecast.avgDailyCostUsd, 2);
  assert.equal(forecast.projectedTokens, 1000 * 30);
  assert.equal(forecast.projectedCostUsd, 2 * 30);
});

test('forecastBurnRate averages a consistent daily burn rate across multiple days and projects forward', () => {
  const days = [
    { date: '2026-07-24', tokenTotal: 500, costUsd: 1 },
    { date: '2026-07-25', tokenTotal: 500, costUsd: 1 },
    { date: '2026-07-26', tokenTotal: 500, costUsd: 1 },
    { date: '2026-07-27', tokenTotal: 500, costUsd: 1 },
    { date: '2026-07-28', tokenTotal: 500, costUsd: 1 },
    { date: '2026-07-29', tokenTotal: 500, costUsd: 1 },
    { date: '2026-07-30', tokenTotal: 500, costUsd: 1 },
  ];
  const forecast = forecastBurnRate(days);
  assert.equal(forecast.daysObserved, 7);
  assert.equal(forecast.avgDailyTokens, 500);
  assert.equal(forecast.avgDailyCostUsd, 1);
  assert.equal(forecast.projectedTokens, 500 * 30);
  assert.equal(forecast.projectedCostUsd, 1 * 30);
});

test('forecastBurnRate uses whatever days are available when fewer than the window size exist', () => {
  const days = [
    { date: '2026-07-29', tokenTotal: 200, costUsd: 0.5 },
    { date: '2026-07-30', tokenTotal: 400, costUsd: 1.5 },
  ];
  const forecast = forecastBurnRate(days, { windowDays: 7 });
  assert.equal(forecast.daysObserved, 2);
  assert.equal(forecast.avgDailyTokens, 300);
  assert.equal(forecast.avgDailyCostUsd, 1);
});

test('forecastBurnRate only considers the last windowDays entries when more history exists', () => {
  const days = [
    { date: '2026-07-01', tokenTotal: 9999, costUsd: 999 }, // outside window, should be ignored
    { date: '2026-07-24', tokenTotal: 100, costUsd: 1 },
    { date: '2026-07-25', tokenTotal: 100, costUsd: 1 },
    { date: '2026-07-26', tokenTotal: 100, costUsd: 1 },
    { date: '2026-07-27', tokenTotal: 100, costUsd: 1 },
    { date: '2026-07-28', tokenTotal: 100, costUsd: 1 },
    { date: '2026-07-29', tokenTotal: 100, costUsd: 1 },
    { date: '2026-07-30', tokenTotal: 100, costUsd: 1 },
  ];
  const forecast = forecastBurnRate(days, { windowDays: 7 });
  assert.equal(forecast.daysObserved, 7);
  assert.equal(forecast.avgDailyTokens, 100);
  assert.equal(forecast.avgDailyCostUsd, 1);
});

test('buildTimeline maps usageRecords to chronological usage points with correct field mapping', () => {
  const session = makeSession({
    usageRecords: [
      {
        timestamp: '2026-07-30T10:00:00.000Z',
        model: 'claude-sonnet-5-20260101',
        inputTokens: 100,
        outputTokens: 20,
        cacheCreationInputTokens: 5,
        cacheReadInputTokens: 2,
      },
      {
        timestamp: '2026-07-30T10:05:00.000Z',
        model: 'claude-sonnet-5-20260101',
        inputTokens: 50,
        outputTokens: 10,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      },
    ],
    toolEvents: [],
  });

  const timeline = buildTimeline(session);

  assert.equal(timeline.usage.length, 2);
  // Chronological order preserved (input order, since usageRecords are
  // already chronological as produced by store.js).
  assert.equal(timeline.usage[0].timestamp, '2026-07-30T10:00:00.000Z');
  assert.equal(timeline.usage[1].timestamp, '2026-07-30T10:05:00.000Z');

  const first = timeline.usage[0];
  assert.equal(first.model, 'claude-sonnet-5-20260101');
  assert.equal(first.inputTokens, 100);
  assert.equal(first.outputTokens, 20);
  assert.equal(first.cacheCreationInputTokens, 5);
  assert.equal(first.cacheReadInputTokens, 2);
  assert.equal(first.tokenTotal, 100 + 20 + 5 + 2);
});

test('buildTimeline maps toolEvents to tools[] with timestamp/name/kind', () => {
  const session = makeSession({
    usageRecords: [],
    toolEvents: [
      { timestamp: '2026-07-30T10:00:00.000Z', name: 'Read', kind: 'tool_use' },
      { timestamp: '2026-07-30T10:01:00.000Z', name: 'Bash', kind: 'tool_use' },
    ],
  });

  const timeline = buildTimeline(session);

  assert.equal(timeline.tools.length, 2);
  assert.deepEqual(timeline.tools[0], {
    timestamp: '2026-07-30T10:00:00.000Z',
    name: 'Read',
    kind: 'tool_use',
  });
  assert.deepEqual(timeline.tools[1], {
    timestamp: '2026-07-30T10:01:00.000Z',
    name: 'Bash',
    kind: 'tool_use',
  });
});

test('buildTimeline gracefully handles missing/empty usageRecords and toolEvents', () => {
  const sessionMissing = makeSession({ usageRecords: undefined, toolEvents: undefined });
  delete sessionMissing.usageRecords;

  const timelineMissing = buildTimeline(sessionMissing);
  assert.deepEqual(timelineMissing, { usage: [], tools: [] });

  const sessionEmpty = makeSession({ usageRecords: [], toolEvents: [] });
  const timelineEmpty = buildTimeline(sessionEmpty);
  assert.deepEqual(timelineEmpty, { usage: [], tools: [] });
});

test('buildTimeline downsamples sessions with more than 500 usageRecords to exactly 500 points via even-stride sampling, keeping the last point', () => {
  const totalRecords = 1000;
  const usageRecords = Array.from({ length: totalRecords }, (_, i) => ({
    timestamp: new Date(2026, 0, 1, 0, i).toISOString(),
    model: 'claude-sonnet-5',
    inputTokens: i, // unique per-record marker to verify stride sampling
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  }));

  const session = makeSession({ usageRecords, toolEvents: [] });
  const timeline = buildTimeline(session);

  assert.equal(timeline.usage.length, 500);

  // First point should be the first record (stride sampling starts at index 0).
  assert.equal(timeline.usage[0].inputTokens, 0);

  // Last point must always be the actual last record (index 999), per the
  // implementation's explicit "always keep the last point" behavior.
  assert.equal(timeline.usage[499].inputTokens, totalRecords - 1);

  // Verify even-stride sampling for the rest: point i (i < 499) should be
  // record at index floor(i * stride), where stride = totalRecords / 500.
  const stride = totalRecords / 500;
  for (let i = 0; i < 499; i++) {
    const expectedIndex = Math.floor(i * stride);
    assert.equal(timeline.usage[i].inputTokens, expectedIndex);
  }

  // Chronological order is preserved (timestamps strictly increasing).
  for (let i = 1; i < timeline.usage.length; i++) {
    assert.ok(
      new Date(timeline.usage[i].timestamp).getTime() >=
        new Date(timeline.usage[i - 1].timestamp).getTime()
    );
  }
});

test('buildTimeline passes sessions at exactly the 500-point cap through untouched', () => {
  const usageRecords = Array.from({ length: 500 }, (_, i) => ({
    timestamp: new Date(2026, 0, 1, 0, i).toISOString(),
    inputTokens: i,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  }));

  const session = makeSession({ usageRecords, toolEvents: [] });
  const timeline = buildTimeline(session);

  assert.equal(timeline.usage.length, 500);
  // No downsampling should occur at exactly the cap — every original point
  // preserved in order.
  for (let i = 0; i < 500; i++) {
    assert.equal(timeline.usage[i].inputTokens, i);
  }
});
