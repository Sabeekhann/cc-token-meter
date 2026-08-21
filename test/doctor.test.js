import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runDiagnostics } from '../src/cli/commands/doctor.js';
import { writeLocalIndex } from '../src/ingest/localIndex.js';

test('doctor reports a healthy private local setup', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-token-meter-doctor-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const projectsDir = path.join(home, '.claude', 'projects');
  const stateDir = path.join(home, '.claude-token-meter');
  const indexFile = path.join(stateDir, 'usage-index-v2.json');
  const configFile = path.join(stateDir, 'config.json');
  fs.mkdirSync(projectsDir, { recursive: true });
  writeLocalIndex({ sessions: [], files: [], totalIngestedMessages: 0 }, indexFile);
  fs.writeFileSync(configFile, JSON.stringify({ dailyCostCapUsd: 10 }), { mode: 0o600 });
  fs.chmodSync(stateDir, 0o700);

  const report = await runDiagnostics({
    homedir: home,
    nodeVersion: '24.1.0',
    platform: process.platform,
    now: '2026-08-21T12:00:00.000Z',
    discoverFiles: async () => [{ filePath: '/synthetic/session.jsonl' }],
  });

  assert.equal(report.overall, 'pass');
  assert.ok(report.checks.every((check) => check.level === 'pass'));
});

test('doctor treats a fresh install as actionable warnings, not a crash', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-token-meter-doctor-fresh-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));

  const report = await runDiagnostics({
    homedir: home,
    nodeVersion: '24.1.0',
    platform: 'linux',
    now: '2026-08-21T12:00:00.000Z',
    discoverFiles: async () => [],
  });

  assert.equal(report.overall, 'warn');
  assert.equal(report.checks.find((check) => check.id === 'transcripts').level, 'warn');
  assert.equal(report.checks.find((check) => check.id === 'index').level, 'warn');
  assert.equal(report.checks.find((check) => check.id === 'config').level, 'warn');
});

test('doctor warns when the bundled pricing verification is stale', async () => {
  const report = await runDiagnostics({
    homedir: '/synthetic/fresh-install',
    nodeVersion: '24.1.0',
    platform: 'linux',
    now: '2026-12-01T00:00:00.000Z',
    discoverFiles: async () => [],
  });

  const pricing = report.checks.find((check) => check.id === 'pricing');
  assert.equal(pricing.level, 'warn');
  assert.match(pricing.detail, /official Anthropic pricing page/);
});
