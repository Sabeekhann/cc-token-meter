import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  DEFAULT_CONFIG,
  readConfig,
  validateConfigUpdates,
  writeConfig,
} from '../src/budget/config.js';
import { parseArgs } from '../src/cli/index.js';

test('budget config rejects negative, non-finite, and out-of-range values', () => {
  assert.throws(() => validateConfigUpdates({ dailyCostCapUsd: -1 }), /non-negative/);
  assert.throws(() => validateConfigUpdates({ dailyTokenCap: Number.POSITIVE_INFINITY }), /non-negative/);
  assert.throws(() => validateConfigUpdates({ warnThresholdPct: 0 }), /1 to 100/);
  assert.throws(() => validateConfigUpdates({ warnThresholdPct: 101 }), /1 to 100/);
  assert.throws(() => validateConfigUpdates({ unknown: 1 }), /unsupported/);
});

test('stored invalid values fall back safely without preserving unknown keys', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-token-meter-config-invalid-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'config.json');
  fs.writeFileSync(filePath, JSON.stringify({
    dailyCostCapUsd: -5,
    dailyTokenCap: 1000,
    warnThresholdPct: 500,
    unexpected: 'value',
  }));

  assert.deepEqual(readConfig(filePath), {
    ...DEFAULT_CONFIG,
    dailyTokenCap: 1000,
  });
});

test('config writes leave no temporary file after an atomic replace', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-token-meter-config-atomic-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'state', 'config.json');

  writeConfig({ dailyCostCapUsd: 12 }, filePath);
  writeConfig({ dailyCostCapUsd: 20 }, filePath);

  assert.equal(readConfig(filePath).dailyCostCapUsd, 20);
  assert.deepEqual(fs.readdirSync(path.dirname(filePath)), ['config.json']);
});

test('CLI rejects negative budget values before writing config', () => {
  assert.throws(() => parseArgs(['--set-budget-usd', '-1']), /non-negative/);
  assert.throws(() => parseArgs(['--set-budget-tokens', '-1']), /non-negative/);
  assert.throws(() => parseArgs(['--set-session-budget-usd', '-1']), /non-negative/);
});
