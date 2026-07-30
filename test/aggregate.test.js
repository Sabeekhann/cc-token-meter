import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateByProject, aggregateByDay, getTodayTotal } from '../src/ingest/aggregate.js';

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
