import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DEFAULT_CONFIG, readConfig, writeConfig } from '../src/budget/config.js';

test('reading a missing config is side-effect free', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-token-meter-config-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'missing', 'config.json');

  assert.deepEqual(readConfig(filePath), DEFAULT_CONFIG);
  assert.equal(fs.existsSync(path.dirname(filePath)), false);
});

test('writing config merges defaults and uses private permissions', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-token-meter-config-write-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'state', 'config.json');

  const written = writeConfig({ dailyCostCapUsd: 12 }, filePath);
  assert.equal(written.dailyCostCapUsd, 12);
  assert.equal(written.warnThresholdPct, 80);
  assert.deepEqual(readConfig(filePath), written);

  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(path.dirname(filePath)).mode & 0o777, 0o700);
    assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
  }
});
