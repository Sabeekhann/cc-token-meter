import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { getMonthToDate } from '../src/ingest/aggregate.js';
import { computeMonthAlerts } from '../src/budget/alerts.js';
import { buildSummary } from '../src/server/summary.js';
import { parseArgs } from '../src/cli/index.js';
import { formatCompactSummary } from '../src/cli/commands/summary.js';
import { validateConfigUpdates } from '../src/budget/config.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
// Local-time constructor keeps month boundaries timezone-independent.
const at = (month, day, hour = 12) => new Date(2026, month - 1, day, hour);

test('getMonthToDate sums the current local month and projects the run rate', () => {
  const days = [
    { date: '2026-09-30', tokenTotal: 999, costUsd: 99 },
    { date: '2026-10-01', tokenTotal: 100, costUsd: 1 },
    { date: '2026-10-05', tokenTotal: 200, costUsd: 3 },
    { date: '2026-11-01', tokenTotal: 999, costUsd: 99 },
  ];
  // Oct 11 00:00 → exactly 10 elapsed days of a 31-day month.
  const month = getMonthToDate(days, new Date(2026, 9, 11, 0, 0));
  assert.equal(month.month, '2026-10');
  assert.equal(month.tokenTotal, 300);
  assert.equal(month.costUsd, 4);
  assert.equal(month.daysInMonth, 31);
  assert.equal(month.elapsedDays, 10);
  assert.ok(Math.abs(month.projectedCostUsd - 12.4) < 1e-9);
  assert.ok(Math.abs(month.projectedTokens - 930) < 1e-9);
});

test('getMonthToDate treats the start of the month as at least one day', () => {
  const month = getMonthToDate([{ date: '2026-10-01', tokenTotal: 10, costUsd: 2 }], new Date(2026, 9, 1, 1, 0));
  assert.equal(month.elapsedDays, 1);
  assert.equal(month.projectedCostUsd, 62, 'two dollars in the first day, not in the first hour');
  assert.equal(getMonthToDate([], at(2, 15)).daysInMonth, 28);
});

const month = { month: '2026-10', costUsd: 0, tokenTotal: 0, projectedCostUsd: 0, projectedTokens: 0 };

test('computeMonthAlerts warns near, over, and on pace to pass a monthly budget', () => {
  const cfg = { warnThresholdPct: 80, monthlyCostCapUsd: 100, monthlyTokenCap: 1000 };
  const near = computeMonthAlerts({ ...month, costUsd: 85, projectedCostUsd: 95 }, cfg);
  assert.deepEqual(near.map(({ id, level }) => [id, level]), [['month-cost:2026-10', 'warn']]);

  const pace = computeMonthAlerts({ ...month, costUsd: 30, projectedCostUsd: 140, tokenTotal: 100, projectedTokens: 1500 }, cfg);
  assert.deepEqual(pace.map(({ id }) => id), ['month-pace-cost:2026-10', 'month-pace-tokens:2026-10']);
  assert.match(pace[0].message, /on pace for \$140\.00 by month end, above your \$100\.00 budget/);

  const over = computeMonthAlerts({ ...month, costUsd: 120, projectedCostUsd: 300 }, cfg);
  assert.deepEqual(over.map(({ id, level }) => [id, level]), [['month-cost:2026-10', 'exceeded']]);
});

test('computeMonthAlerts is silent without monthly budgets', () => {
  assert.deepEqual(computeMonthAlerts({ ...month, costUsd: 1e6, projectedCostUsd: 1e7 }, { warnThresholdPct: 80 }), []);
  assert.deepEqual(computeMonthAlerts(null, { monthlyCostCapUsd: 1 }), []);
});

test('summary reports month-to-date usage from all sessions and raises monthly alerts', () => {
  const now = new Date();
  const session = (sessionId, projectCwd) => ({
    sessionId,
    projectCwd,
    models: ['claude-sonnet-5'],
    messageCount: 1,
    inputTokens: 100,
    outputTokens: 0,
    costUsd: 30,
    lastTimestamp: now.toISOString(),
    usageRecords: [{ timestamp: now.toISOString(), inputTokens: 100, outputTokens: 0, costUsd: 30, model: 'claude-sonnet-5' }],
    toolEvents: [],
  });
  const store = { getSnapshot: () => ({ sessions: [session('a', '/work/alpha'), session('b', '/work/beta')], totalIngestedMessages: 2 }) };
  const config = { warnThresholdPct: 80, monthlyCostCapUsd: 50 };

  const filtered = buildSummary(store, { config, filters: { project: 'alpha' } });
  assert.equal(filtered.month.costUsd, 60, 'monthly budgets cover every project, like the budget itself');
  assert.ok(filtered.alerts.some((alert) => alert.id.startsWith('month-cost:') && alert.level === 'exceeded'));
});

test('monthly budget flags and config validate', () => {
  assert.equal(parseArgs(['--set-monthly-budget-usd', '200']).setMonthlyBudgetUsd, 200);
  assert.equal(parseArgs(['--set-monthly-budget-tokens', '0']).setMonthlyBudgetTokens, 0);
  assert.throws(() => parseArgs(['--set-monthly-budget-usd', '-5']), /non-negative/);
  assert.deepEqual(validateConfigUpdates({ monthlyCostCapUsd: 200, monthlyTokenCap: null }), { monthlyCostCapUsd: 200, monthlyTokenCap: null });
  assert.throws(() => validateConfigUpdates({ monthlyCostCapUsd: -1 }), /non-negative/);
});

test('--summary prints a month line with budget progress and pace', () => {
  const output = formatCompactSummary({
    month: { month: '2026-10', tokenTotal: 1200, costUsd: 40, projectedCostUsd: 124 },
    config: { monthlyCostCapUsd: 100 },
  });
  assert.match(output, /Month \(2026-10\): 1,200 tokens · \$40\.00 · 40% of \$100\.00 budget · on pace for \$124\.00/);
  assert.match(formatCompactSummary({}), /Month: no usage yet/);
});

test('dashboard shows monthly progress and saves monthly caps', () => {
  const html = fs.readFileSync(path.join(publicDir, 'dashboard.html'), 'utf8');
  const js = fs.readFileSync(path.join(publicDir, 'dashboard.js'), 'utf8');
  for (const id of ['monthlyCostCapUsd', 'monthlyTokenCap']) {
    assert.match(html, new RegExp(`<label>[\\s\\S]*?<input id="${id}"`));
    assert.match(js, new RegExp(`${id}: inputNumberOrNull\\('${id}'\\)`));
  }
  assert.match(html, /id="monthSpend"/);
  assert.match(js, /renderMonthBudget\(summary\.month, config\)/);
});
