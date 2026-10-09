import assert from 'node:assert/strict';
import test from 'node:test';
import { computeAlerts, computePlanAlerts } from '../src/budget/alerts.js';
import { buildSummary } from '../src/server/summary.js';

const config = { warnThresholdPct: 80, dailyTokenCap: 1000, dailyCostCapUsd: 10, sessionCostCapUsd: 5, sessionTokenCap: null };

test('computeAlerts gives each alert a stable id, level, and scope', () => {
  const alerts = computeAlerts(
    { tokenTotal: 850, costUsd: 12 },
    [{ sessionId: 'abcdef123456', tokenTotal: 1, costUsd: 4.5 }, { sessionId: 'quiet', tokenTotal: 1, costUsd: 1 }],
    config,
  );
  assert.deepEqual(alerts.map(({ id, level, scope }) => [id, level, scope]), [
    ['day-tokens', 'warn', 'day'],
    ['day-cost', 'exceeded', 'day'],
    ['session-cost:abcdef123456', 'warn', 'session'],
  ]);
  assert.match(alerts[2].message, /Session abcdef12 cost is at 90% of its cap/);
});

const block = (overrides) => ({
  start: '2026-10-09T12:00:00.000Z',
  tokenTotal: 0,
  projectedTokens: 0,
  reference: 1000,
  referenceKind: 'limit',
  ...overrides,
});

test('computePlanAlerts warns near the window limit and when on pace to pass it', () => {
  const near = computePlanAlerts({ plan: 'max5x', currentBlock: block({ tokenTotal: 850, projectedTokens: 900 }) }, config);
  assert.deepEqual(near.map(({ id, level }) => [id, level]), [['window-tokens:2026-10-09T12:00:00.000Z', 'warn']]);

  const pace = computePlanAlerts({ plan: 'max5x', currentBlock: block({ tokenTotal: 300, projectedTokens: 1400 }) }, config);
  assert.deepEqual(pace.map(({ id, level }) => [id, level]), [['window-pace:2026-10-09T12:00:00.000Z', 'warn']]);
  assert.match(pace[0].message, /reaches 1,400 tokens before it resets/);

  const over = computePlanAlerts({ plan: 'max5x', currentBlock: block({ tokenTotal: 1200, projectedTokens: 2000 }) }, config);
  assert.deepEqual(over.map(({ level }) => level), ['exceeded'], 'no extra pace alert once exceeded');
});

test('computePlanAlerts only alerts on user-set limits', () => {
  const record = computePlanAlerts(
    { plan: 'pro', currentBlock: block({ tokenTotal: 5000, projectedTokens: 9000, referenceKind: 'record' }) },
    config,
  );
  assert.deepEqual(record, [], 'the personal record is a comparison, not a limit');
  assert.deepEqual(computePlanAlerts({ plan: 'api', currentBlock: block({ tokenTotal: 5000 }) }, config), []);
  assert.deepEqual(computePlanAlerts(null, config), []);

  const weekly = computePlanAlerts({ plan: 'pro', currentBlock: null, weekly: { tokenTotal: 950, limit: 1000 } }, config);
  assert.deepEqual(weekly.map(({ id, level, scope }) => [id, level, scope]), [['week-tokens', 'warn', 'week']]);
});

test('summary raises session alerts only for sessions that ran today', () => {
  const now = new Date();
  const session = (sessionId, lastTimestamp) => ({
    sessionId,
    projectCwd: '/work/alpha',
    models: ['claude-sonnet-5'],
    messageCount: 1,
    inputTokens: 10,
    outputTokens: 0,
    costUsd: 9,
    lastTimestamp,
    usageRecords: [],
    toolEvents: [],
  });
  const store = {
    getSnapshot: () => ({
      sessions: [
        session('today-session', now.toISOString()),
        session('old-session', new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString()),
      ],
      totalIngestedMessages: 2,
    }),
  };
  const summary = buildSummary(store, { config: { warnThresholdPct: 80, sessionCostCapUsd: 5, plan: 'api' } });
  assert.deepEqual(summary.alerts.map((alert) => alert.id), ['session-cost:today-session']);
});
