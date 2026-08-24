import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cc token meter lifecycle '));
const packDirectory = path.join(temporaryRoot, 'packed artifact');
const installDirectory = path.join(temporaryRoot, 'clean install');
const isolatedHome = path.join(temporaryRoot, 'isolated home');
const guardFile = path.join(temporaryRoot, 'network-guard.cjs');
const guardLog = path.join(temporaryRoot, 'blocked-network.log');
const temporaryNpmCache = path.join(temporaryRoot, 'npm cache');
const stateDirectory = path.join(isolatedHome, '.claude-token-meter');
const indexFile = path.join(stateDirectory, 'usage-index-v3.json');
const legacyIndexFile = path.join(stateDirectory, 'usage-index-v2.json');
const configFile = path.join(stateDirectory, 'config.json');
const csvFile = path.join(temporaryRoot, 'exports with spaces', 'usage report.csv');

try {
  fs.mkdirSync(packDirectory, { recursive: true });
  fs.mkdirSync(installDirectory, { recursive: true });
  fs.mkdirSync(path.dirname(csvFile), { recursive: true });
  fs.writeFileSync(path.join(installDirectory, 'package.json'), JSON.stringify({ private: true }), 'utf8');
  writeNetworkGuard();
  writeSyntheticTranscript();

  const packed = run(npmCommand, [
    'pack',
    '--json',
    '--ignore-scripts',
    '--offline',
    '--pack-destination',
    packDirectory,
  ], { cwd: root, env: npmEnvironment() });
  const packResult = JSON.parse(packed.stdout);
  assert.equal(packResult.length, 1);
  const tarball = path.join(packDirectory, packResult[0].filename);
  assert.ok(fs.existsSync(tarball), 'npm pack must create the release tarball');

  installTarball(tarball);
  const binary = path.join(installDirectory, 'node_modules', 'cc-token-meter', 'bin', 'cc-token-meter.js');
  assert.ok(fs.existsSync(binary), 'clean install must contain the published binary');
  assert.match(runCli(binary, ['--version']).stdout, /^\d+\.\d+\.\d+\s*$/);

  const cleanSummary = runCli(binary, ['--summary']).stdout;
  assert.match(cleanSummary, /Selected: 2,040 tokens/);
  runCli(binary, ['--set-budget-usd', '12.5']);
  const warmIndex = fs.readFileSync(indexFile, 'utf8');
  const warmConfig = fs.readFileSync(configFile, 'utf8');

  installTarball(tarball, true);
  const doctor = JSON.parse(runCli(binary, ['--doctor', '--json']).stdout);
  assert.notEqual(doctor.overall, 'fail');
  assert.equal(doctor.checks.find((check) => check.id === 'index').level, 'pass');
  assert.equal(doctor.checks.find((check) => check.id === 'config').level, 'pass');

  assert.match(runCli(binary, ['--summary']).stdout, /Selected: 2,040 tokens/);
  const json = JSON.parse(runCli(binary, ['--json']).stdout);
  assert.equal(json.totalIngestedMessages, 2);
  assert.equal(json.allTime.tokenTotal, 2040);
  assert.equal(json.config.dailyCostCapUsd, 12.5);
  runCli(binary, ['--csv', csvFile, '--group-by', 'session']);
  assert.match(fs.readFileSync(csvFile, 'utf8'), /^sessionId,project,gitBranch,/);
  assert.equal(fs.readFileSync(indexFile, 'utf8'), warmIndex, 'warm upgrade must preserve a valid index');
  assert.equal(fs.readFileSync(configFile, 'utf8'), warmConfig, 'warm upgrade must preserve valid config');

  const legacyIndex = JSON.parse(warmIndex);
  legacyIndex.version = 2;
  for (const session of legacyIndex.sessions) delete session.dailyRollups;
  fs.writeFileSync(legacyIndexFile, JSON.stringify(legacyIndex), 'utf8');
  fs.rmSync(indexFile);
  const migrated = JSON.parse(runCli(binary, ['--json']).stdout);
  assert.equal(migrated.totalIngestedMessages, 2);
  assert.equal(JSON.parse(fs.readFileSync(indexFile, 'utf8')).version, 3);

  fs.writeFileSync(indexFile, '{broken', 'utf8');
  const recovered = JSON.parse(runCli(binary, ['--json']).stdout);
  assert.equal(recovered.totalIngestedMessages, 2);
  assert.equal(JSON.parse(fs.readFileSync(indexFile, 'utf8')).version, 3);

  fs.writeFileSync(indexFile, JSON.stringify({
    version: 999,
    sessions: [],
    files: [],
    totalIngestedMessages: 0,
  }), 'utf8');
  assert.match(runCli(binary, ['--summary']).stdout, /Selected: 2,040 tokens/);
  assert.equal(JSON.parse(fs.readFileSync(indexFile, 'utf8')).version, 3);

  if (process.env.CC_TOKEN_METER_SKIP_LOOPBACK_TEST !== '1') {
    await verifyDashboard(binary);
  }
  const packagedServer = fs.readFileSync(
    path.join(installDirectory, 'node_modules', 'cc-token-meter', 'src', 'server', 'index.js'),
    'utf8',
  );
  assert.match(packagedServer, /server\.listen\(port, '127\.0\.0\.1'/);
  assert.equal(fs.existsSync(guardLog), false, 'runtime must not attempt non-loopback networking');

  console.log('Packed release lifecycle passed: clean install, warm upgrade, recovery, exports, and offline loopback runtime.');
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

function installTarball(tarball, force = false) {
  const args = ['install', tarball, '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline'];
  if (force) args.push('--force');
  run(npmCommand, args, { cwd: installDirectory, env: npmEnvironment(), timeout: 120_000 });
}

function npmEnvironment() {
  const configured = process.env.npm_config_cache || process.env.NPM_CONFIG_CACHE;
  const cache = configured && fs.existsSync(configured) ? configured : temporaryNpmCache;
  fs.mkdirSync(cache, { recursive: true });
  return {
    ...process.env,
    npm_config_cache: cache,
    npm_config_update_notifier: 'false',
  };
}

function runCli(binary, args) {
  return run(process.execPath, [binary, ...args], {
    cwd: installDirectory,
    env: guardedEnvironment(),
  });
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    env: options.env || process.env,
    encoding: 'utf8',
    timeout: options.timeout || 30_000,
    windowsHide: true,
  });
  assert.ifError(result.error);
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result;
}

function guardedEnvironment() {
  const requiredOption = `--require=${JSON.stringify(guardFile)}`;
  return {
    ...process.env,
    CC_TOKEN_METER_HOME: isolatedHome,
    CC_TOKEN_METER_NETWORK_GUARD_LOG: guardLog,
    NODE_OPTIONS: [process.env.NODE_OPTIONS, requiredOption].filter(Boolean).join(' '),
  };
}

function writeSyntheticTranscript() {
  const projectDirectory = path.join(isolatedHome, '.claude', 'projects', '-synthetic-project-with-spaces');
  fs.mkdirSync(projectDirectory, { recursive: true });
  const records = [
    assistantRecord('2026-08-24T08:00:00.000Z', 1000, 100, 200, 300),
    assistantRecord('2026-08-24T08:01:00.000Z', 200, 40, 0, 200),
  ];
  fs.writeFileSync(
    path.join(projectDirectory, 'synthetic-session.jsonl'),
    `${records.map(JSON.stringify).join(os.EOL)}${os.EOL}`,
    'utf8',
  );
}

function assistantRecord(timestamp, inputTokens, outputTokens, cacheCreation, cacheRead) {
  return {
    type: 'assistant',
    sessionId: 'synthetic-session',
    timestamp,
    cwd: path.join(temporaryRoot, 'project with spaces'),
    gitBranch: 'release-test',
    version: '2.1.0',
    message: {
      model: 'claude-sonnet-5',
      content: [],
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_creation_input_tokens: cacheCreation,
        cache_read_input_tokens: cacheRead,
      },
    },
  };
}

function writeNetworkGuard() {
  fs.writeFileSync(guardFile, String.raw`
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const tls = require('node:tls');

function loopback(value) {
  const host = String(value || '').replace(/^\[|\]$/g, '').toLowerCase();
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

function reject(kind, host) {
  const target = String(host || 'unknown');
  if (process.env.CC_TOKEN_METER_NETWORK_GUARD_LOG) {
    fs.appendFileSync(process.env.CC_TOKEN_METER_NETWORK_GUARD_LOG, kind + ':' + target + '\n');
  }
  throw new Error('non-loopback network blocked: ' + kind + ' ' + target);
}

function requestHost(args) {
  const first = args[0];
  if (typeof first === 'string' || first instanceof URL) return new URL(first).hostname;
  return first && (first.hostname || first.host);
}

function guardRequest(module, name) {
  const original = module[name];
  module[name] = function (...args) {
    const host = requestHost(args);
    if (!loopback(host)) reject(name, host);
    return original.apply(this, args);
  };
}

guardRequest(http, 'request');
guardRequest(http, 'get');
guardRequest(https, 'request');
guardRequest(https, 'get');

const originalConnect = net.connect;
net.connect = function (...args) {
  const first = args[0];
  const host = first && typeof first === 'object'
    ? first.host
    : typeof args[1] === 'string'
      ? args[1]
      : 'localhost';
  if (!loopback(host)) reject('net.connect', host);
  return originalConnect.apply(this, args);
};
net.createConnection = net.connect;

const originalTlsConnect = tls.connect;
tls.connect = function (...args) {
  const first = args[0];
  const host = first && typeof first === 'object' ? first.host : args[1];
  if (!loopback(host)) reject('tls.connect', host);
  return originalTlsConnect.apply(this, args);
};

globalThis.fetch = async function (input) {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (!loopback(url.hostname)) reject('fetch', url.hostname);
  throw new Error('loopback fetch is not needed by the cc-token-meter runtime');
};
`, 'utf8');
}

async function verifyDashboard(binary) {
  const port = await reservePort();
  const child = spawn(process.execPath, [binary, '--port', String(port), '--no-open', '--no-cache'], {
    cwd: installDirectory,
    env: guardedEnvironment(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  try {
    await waitFor(() => stdout.includes(`http://127.0.0.1:${port}`), 15_000, () => (
      `dashboard did not start\nstdout:\n${stdout}\nstderr:\n${stderr}`
    ));
    const response = await requestJson(port, '/api/summary');
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.totalIngestedMessages, 2);
  } finally {
    child.kill();
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 3_000)),
    ]);
    if (child.exitCode == null) child.kill('SIGKILL');
  }
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function requestJson(port, pathname) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port, path: pathname }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        try {
          resolve({ statusCode: response.statusCode, body: JSON.parse(body) });
        } catch (error) {
          reject(error);
        }
      });
    });
    request.once('error', reject);
  });
}

async function waitFor(predicate, timeout, describeFailure) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(describeFailure());
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
