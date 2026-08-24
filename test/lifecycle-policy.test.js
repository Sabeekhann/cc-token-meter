import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const runner = fs.readFileSync(path.join(root, 'test', 'release-lifecycle.mjs'), 'utf8');
const requiredWorkflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'tests.yml'), 'utf8');
const compatibilityWorkflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'compatibility.yml'), 'utf8');

test('packed lifecycle remains a post-merge compatibility gate', () => {
  assert.doesNotMatch(requiredWorkflow, /test:lifecycle/);
  assert.match(compatibilityWorkflow, /npm run test:lifecycle/);
  assert.doesNotMatch(compatibilityWorkflow, /pull_request:/);
});

test('packed lifecycle covers isolated install, upgrade, recovery, export, and offline runtime', () => {
  assert.match(runner, /run\(npmCommand, \[\s*'pack'/);
  assert.match(runner, /const args = \['install', tarball/);
  assert.match(runner, /CC_TOKEN_METER_HOME/);
  assert.match(runner, /--doctor/);
  assert.match(runner, /--summary/);
  assert.match(runner, /--json/);
  assert.match(runner, /--csv/);
  assert.match(runner, /version: 999/);
  assert.match(runner, /usage-index-v2\.json/);
  assert.match(runner, /migrated\.totalIngestedMessages/);
  assert.match(runner, /writeFileSync\(indexFile, '\{broken'/);
  assert.match(runner, /127\.0\.0\.1/);
  assert.match(runner, /network-guard\.cjs/);
  assert.match(runner, /os\.EOL/);
});

test('the isolated home override is explicit and does not change normal defaults', async () => {
  const { resolveHomeDirectory } = await import('../src/paths.js');
  assert.equal(resolveHomeDirectory({ CC_TOKEN_METER_HOME: './space home' }), path.resolve('./space home'));
  assert.equal(typeof resolveHomeDirectory({}), 'string');
  assert.ok(resolveHomeDirectory({}).length > 0);
});
