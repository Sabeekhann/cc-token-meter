import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
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
import { handleApiRoute } from '../src/server/routes.js';

test('budget config rejects negative, non-finite, out-of-range, and malformed updates', () => {
  assert.throws(() => validateConfigUpdates({ dailyCostCapUsd: -1 }), /non-negative/);
  assert.throws(() => validateConfigUpdates({ dailyTokenCap: Number.POSITIVE_INFINITY }), /non-negative/);
  assert.throws(() => validateConfigUpdates({ sessionTokenCap: Number.NaN }), /non-negative/);
  assert.throws(() => validateConfigUpdates({ warnThresholdPct: 0 }), /1 to 100/);
  assert.throws(() => validateConfigUpdates({ warnThresholdPct: 101 }), /1 to 100/);
  assert.throws(() => validateConfigUpdates({ warnThresholdPct: Number.NaN }), /1 to 100/);
  assert.throws(() => validateConfigUpdates({ unknown: 1 }), /unsupported/);
  assert.throws(() => validateConfigUpdates(null), /must be an object/);
  assert.throws(() => validateConfigUpdates([]), /must be an object/);
});

test('budget config accepts every supported cap, null resets, and threshold boundaries', () => {
  assert.deepEqual(validateConfigUpdates({
    dailyTokenCap: 0,
    dailyCostCapUsd: 12.5,
    sessionTokenCap: null,
    sessionCostCapUsd: 3,
    warnThresholdPct: 100,
  }), {
    dailyTokenCap: 0,
    dailyCostCapUsd: 12.5,
    sessionTokenCap: null,
    sessionCostCapUsd: 3,
    warnThresholdPct: 100,
  });
  assert.deepEqual(validateConfigUpdates({ warnThresholdPct: 1 }), { warnThresholdPct: 1 });
});

test('stored invalid values fall back safely without preserving unknown keys', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-token-meter-config-invalid-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'config.json');
  fs.writeFileSync(filePath, JSON.stringify({
    dailyCostCapUsd: -5,
    dailyTokenCap: 1000,
    sessionTokenCap: null,
    sessionCostCapUsd: Number.POSITIVE_INFINITY,
    warnThresholdPct: 500,
    unexpected: 'value',
  }));

  assert.deepEqual(readConfig(filePath), {
    ...DEFAULT_CONFIG,
    dailyTokenCap: 1000,
  });
});

test('malformed and non-object stored configs safely return defaults', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-token-meter-config-malformed-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'config.json');

  for (const raw of ['{', 'null', '[]', '"string"']) {
    fs.writeFileSync(filePath, raw, 'utf8');
    assert.deepEqual(readConfig(filePath), DEFAULT_CONFIG);
  }
});

test('config writes leave no temporary file after an atomic replace and support resets', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-token-meter-config-atomic-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'state', 'config.json');

  writeConfig({ dailyCostCapUsd: 12, warnThresholdPct: 75 }, filePath);
  writeConfig({ dailyCostCapUsd: 20 }, filePath);
  const reset = writeConfig({ dailyCostCapUsd: null }, filePath);

  assert.equal(reset.dailyCostCapUsd, null);
  assert.equal(reset.warnThresholdPct, 75);
  assert.deepEqual(readConfig(filePath), reset);
  assert.deepEqual(fs.readdirSync(path.dirname(filePath)), ['config.json']);
});

test('CLI rejects negative budget values before writing config', () => {
  assert.throws(() => parseArgs(['--set-budget-usd', '-1']), /non-negative/);
  assert.throws(() => parseArgs(['--set-budget-tokens', '-1']), /non-negative/);
  assert.throws(() => parseArgs(['--set-session-budget-usd', '-1']), /non-negative/);
});

test('budget API rejects invalid JSON and invalid values with HTTP 400', async () => {
  async function request(body) {
    const req = new EventEmitter();
    req.method = 'POST';
    req.destroy = () => {};
    const response = {
      statusCode: null,
      headers: null,
      body: '',
      writeHead(statusCode, headers) {
        this.statusCode = statusCode;
        this.headers = headers;
      },
      end(value) {
        this.body = value;
      },
    };

    const handled = handleApiRoute(req, response, new URL('http://127.0.0.1/api/budget'), {});
    process.nextTick(() => {
      req.emit('data', Buffer.from(body));
      req.emit('end');
    });
    assert.equal(await handled, true);
    return response;
  }

  const malformed = await request('{');
  assert.equal(malformed.statusCode, 400);
  assert.equal(JSON.parse(malformed.body).error, 'Invalid JSON body');

  const invalid = await request(JSON.stringify({ dailyCostCapUsd: -1 }));
  assert.equal(invalid.statusCode, 400);
  assert.equal(JSON.parse(invalid.body).error, 'Invalid budget config');
});
