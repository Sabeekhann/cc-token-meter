import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildPlanIntelligence, buildUsageBlocks, PLAN_PRESETS } from '../src/analytics/plan.js';
import { readConfig, validateConfigUpdates, writeConfig } from '../src/budget/config.js';
import { parseArgs } from '../src/cli/index.js';

// Local-time constructors keep window boundaries timezone-independent.
const at = (day, hour, minute = 0) => new Date(2026, 9, day, hour, minute).toISOString();
const rec = (timestamp, tokens, costUsd = 0) => ({ timestamp, inputTokens: tokens, outputTokens: 0, costUsd });

test('buildUsageBlocks opens a window at the local hour and starts a new one after five hours', () => {
  const blocks = buildUsageBlocks([
    rec(at(9, 9, 40), 100),
    rec(at(9, 13, 59), 50),
    rec(at(9, 14, 0), 10), // 09:00 + 5h: first message of a new window
    rec('not-a-date', 999),
    rec(at(9, 22, 15), 5),
  ], { now: at(9, 23, 0) });

  assert.equal(blocks.length, 3);
  assert.equal(blocks[0].start, at(9, 9, 0));
  assert.equal(blocks[0].end, at(9, 14, 0));
  assert.equal(blocks[0].tokenTotal, 150);
  assert.equal(blocks[0].messageCount, 2);
  assert.equal(blocks[1].start, at(9, 14, 0));
  assert.equal(blocks[1].tokenTotal, 10);
  assert.equal(blocks[2].start, at(9, 22, 0));
  assert.deepEqual(blocks.map((block) => block.active), [false, false, true]);
});

test('buildUsageBlocks sorts records and handles no input', () => {
  assert.deepEqual(buildUsageBlocks([]), []);
  const blocks = buildUsageBlocks([rec(at(9, 11), 2), rec(at(9, 10, 30), 1)], { now: at(9, 12) });
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].start, at(9, 10, 0));
  assert.equal(blocks[0].tokenTotal, 3);
});

test('buildPlanIntelligence measures the active window against the personal record without a limit', () => {
  const sessions = [{
    usageRecords: [
      rec(at(8, 10), 4000, 4),
      rec(at(8, 11), 4000, 4), // record window: 8,000 tokens
      rec(at(9, 12), 1000, 1), // active window opens at 12:00
      rec(at(9, 12, 30), 1000, 1),
    ],
  }];

  const plan = buildPlanIntelligence(sessions, { plan: 'max20x' }, { now: at(9, 13, 0) });

  assert.equal(plan.plan, 'max20x');
  assert.equal(plan.planLabel, PLAN_PRESETS.max20x.label);
  assert.equal(plan.planMonthlyUsd, PLAN_PRESETS.max20x.monthlyUsd);
  assert.equal(plan.recordBlockTokens, 8000);
  assert.equal(plan.currentBlock.tokenTotal, 2000);
  assert.equal(plan.currentBlock.remainingMinutes, 240);
  assert.equal(plan.currentBlock.referenceKind, 'record');
  assert.equal(plan.currentBlock.ratio, 0.25);
  // 2,000 tokens in 60 minutes, 240 minutes left at the same pace.
  assert.equal(plan.currentBlock.projectedTokens, 10_000);
  assert.equal(plan.currentBlock.projectedRatio, 1.25);
  assert.equal(plan.weekly.tokenTotal, 10_000);
  assert.equal(plan.weekly.ratio, null);
  assert.equal(plan.apiValue.monthToDateUsd, 10);
  assert.equal(plan.apiValue.multipleOfPlan, 10 / PLAN_PRESETS.max20x.monthlyUsd);
});

test('buildPlanIntelligence prefers user limits and plan price overrides', () => {
  const sessions = [{ usageRecords: [rec(at(9, 12), 3000, 3)] }];
  const plan = buildPlanIntelligence(
    sessions,
    { plan: 'pro', planMonthlyUsd: 30, blockTokenLimit: 6000, weeklyTokenLimit: 12_000 },
    { now: at(9, 12, 30) },
  );
  assert.equal(plan.planMonthlyUsd, 30);
  assert.equal(plan.currentBlock.referenceKind, 'limit');
  assert.equal(plan.currentBlock.ratio, 0.5);
  assert.equal(plan.weekly.ratio, 0.25);
  assert.equal(plan.apiValue.multipleOfPlan, 0.1);
});

test('buildPlanIntelligence is inert for API users and idle periods', () => {
  const plan = buildPlanIntelligence([{ usageRecords: [rec(at(1, 9), 10, 1)] }], {}, { now: at(9, 12) });
  assert.equal(plan.plan, 'api');
  assert.equal(plan.planMonthlyUsd, null);
  assert.equal(plan.currentBlock, null);
  assert.equal(plan.apiValue.multipleOfPlan, null);
  assert.equal(plan.weekly.tokenTotal, 0, 'usage older than seven local days is excluded');

  const unknown = buildPlanIntelligence([], { plan: 'enterprise' }, { now: at(9, 12) });
  assert.equal(unknown.plan, 'api');
});

test('weekly totals include compacted daily rollups from the last seven local days', () => {
  const sessions = [{
    usageRecords: [],
    dailyRollups: [
      { date: '2026-10-03', inputTokens: 500, costUsd: 0.5, messageCount: 1 },
      { date: '2026-10-02', inputTokens: 900, costUsd: 0.9, messageCount: 1 },
    ],
  }];
  const plan = buildPlanIntelligence(sessions, { plan: 'max5x' }, { now: at(9, 12) });
  assert.equal(plan.weekly.tokenTotal, 500);
  assert.ok(Math.abs(plan.apiValue.monthToDateUsd - 1.4) < 1e-9);
});

test('plan settings validate, persist, and sanitize', (t) => {
  assert.deepEqual(validateConfigUpdates({ plan: 'max5x', blockTokenLimit: null }), { plan: 'max5x', blockTokenLimit: null });
  assert.throws(() => validateConfigUpdates({ plan: 'team' }), /plan must be one of/);
  assert.throws(() => validateConfigUpdates({ weeklyTokenLimit: -1 }), /non-negative/);

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-token-meter-plan-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'config.json');
  writeConfig({ plan: 'pro', planMonthlyUsd: 25 }, filePath);
  assert.equal(readConfig(filePath).plan, 'pro');
  assert.equal(readConfig(filePath).planMonthlyUsd, 25);

  fs.writeFileSync(filePath, JSON.stringify({ plan: '<script>', blockTokenLimit: 'lots' }));
  const sanitized = readConfig(filePath);
  assert.equal(sanitized.plan, 'api');
  assert.equal(sanitized.blockTokenLimit, null);
});

test('CLI plan flags parse and validate', () => {
  assert.equal(parseArgs(['--set-plan', 'max20x']).setPlan, 'max20x');
  assert.throws(() => parseArgs(['--set-plan', 'free']), /api, pro, max5x, max20x/);
  assert.equal(parseArgs(['--set-block-token-limit', '0']).setBlockTokenLimit, 0);
  assert.equal(parseArgs(['--set-weekly-token-limit', '5000000']).setWeeklyTokenLimit, 5_000_000);
});
