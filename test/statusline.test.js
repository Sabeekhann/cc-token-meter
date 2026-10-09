import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import {
  contextWindowFor,
  formatStatusline,
  summarizeUsageRecords,
  DEFAULT_CONTEXT_WINDOW,
  EXTENDED_CONTEXT_WINDOW,
} from '../src/analytics/statusline.js';
import {
  buildStatusline,
  parseStatuslineInput,
  statuslineCommand,
} from '../src/cli/commands/statusline.js';
import { parseArgs } from '../src/cli/index.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const binPath = path.join(testDir, '..', 'bin', 'cc-token-meter.js');

// Round-number pricing so assertions never depend on real Anthropic prices.
const TEST_TABLE = [{
  id: 'test',
  matchSubstrings: ['test-model'],
  inputPerMTok: 1,
  outputPerMTok: 10,
  effectiveFrom: null,
  effectiveUntil: null,
}];

function localIso(year, month, day, hour, minute = 0) {
  return new Date(year, month - 1, day, hour, minute).toISOString();
}

function record(timestamp, overrides = {}) {
  return {
    timestamp,
    model: 'test-model',
    inputTokens: 1_000_000,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    ...overrides,
  };
}

function plainSession(overrides = {}) {
  return {
    messageCount: 3,
    tokenTotal: 182_000,
    costUsd: 2.41,
    estimated: false,
    inputTokens: 10_000,
    cacheCreationInputTokens: 16_000,
    cacheReadInputTokens: 74_000,
    latestPromptTokens: 100_000,
    maxPromptTokens: 100_000,
    latestModel: 'claude-sonnet-5',
    ...overrides,
  };
}

test('summarizeUsageRecords totals session usage and separates today by local date', () => {
  const totals = summarizeUsageRecords([
    record(localIso(2026, 10, 8, 23, 30)),
    record(localIso(2026, 10, 9, 9), { inputTokens: 0, outputTokens: 100_000, cacheReadInputTokens: 50_000 }),
    record(null, { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 10 }),
  ], { todayKey: '2026-10-09', pricingTable: TEST_TABLE });

  assert.equal(totals.messageCount, 3);
  assert.equal(totals.tokenTotal, 1_150_010);
  // 1M input at $1/MTok, 100K output at $10/MTok, 50K cache read at 0.1x.
  // Cache writes are priced from their 5m/1h split, which record 3 omits.
  assert.ok(Math.abs(totals.costUsd - 2.005) < 1e-9);
  assert.equal(totals.estimated, false);
  assert.equal(totals.today.tokenTotal, 150_000);
  assert.ok(Math.abs(totals.today.costUsd - 1.005) < 1e-9);
  assert.equal(totals.latestPromptTokens, 10, 'latest prompt is the last record');
  assert.equal(totals.maxPromptTokens, 1_000_000);
});

test('summarizeUsageRecords marks unknown models as estimated', () => {
  const totals = summarizeUsageRecords([record(null, { model: 'unreleased-model' })], { pricingTable: TEST_TABLE });
  assert.equal(totals.estimated, true);
});

test('contextWindowFor detects extended windows from the model suffix or observed prompts', () => {
  assert.equal(contextWindowFor('claude-sonnet-5', 150_000), DEFAULT_CONTEXT_WINDOW);
  assert.equal(contextWindowFor('claude-sonnet-5[1m]', 10), EXTENDED_CONTEXT_WINDOW);
  assert.equal(contextWindowFor(null, 250_000), EXTENDED_CONTEXT_WINDOW);
});

test('formatStatusline prints session, cache, context, and today segments', () => {
  const line = formatStatusline({
    session: plainSession(),
    today: { tokenTotal: 900_000, costUsd: 8.2, estimated: false },
    model: 'claude-sonnet-5',
  });
  assert.equal(line, '◆ $2.41 session · 182K tok · cache 74% · ctx 50% · today $8.20');
  assert.doesNotMatch(line, /\u001b\[/, 'no ANSI codes unless color is requested');
});

test('formatStatusline shows budgets, estimates, partial totals, and colors by threshold', () => {
  const line = formatStatusline({
    session: plainSession({ costUsd: 6, estimated: true, latestPromptTokens: 170_000, maxPromptTokens: 170_000 }),
    today: { tokenTotal: 1, costUsd: 17, estimated: false, partial: true },
    config: { sessionCostCapUsd: 5, dailyCostCapUsd: 20, warnThresholdPct: 80 },
    color: true,
  });
  assert.match(line, /\u001b\[31m≈\$6\.00\/\$5\.00 session\u001b\[0m/);
  assert.match(line, /\u001b\[31mctx 85%\u001b\[0m/);
  assert.match(line, /\u001b\[33mtoday \$17\.00\+\/\$20\.00 \(85%\)\u001b\[0m/);

  const tokenCap = formatStatusline({
    session: plainSession(),
    today: { tokenTotal: 250_000, costUsd: 1, estimated: false },
    config: { dailyTokenCap: 1_000_000 },
  });
  assert.match(tokenCap, /today 250K\/1M tok \(25%\)$/);
});

test('formatStatusline stays useful before the first assistant message', () => {
  assert.equal(
    formatStatusline({ session: null, today: { tokenTotal: 0, costUsd: 0, estimated: false } }),
    '◆ no usage yet this session · today $0.00',
  );
});

test('parseStatuslineInput accepts Claude Code JSON and rejects unsafe or malformed values', () => {
  assert.deepEqual(
    parseStatuslineInput(JSON.stringify({
      session_id: 'abc-123',
      transcript_path: '/etc/passwd',
      model: { id: 'claude-sonnet-5', display_name: 'Sonnet' },
    })),
    { sessionId: 'abc-123', model: 'claude-sonnet-5' },
  );
  assert.deepEqual(parseStatuslineInput('{"session_id":"../../secret"}'), { sessionId: null, model: null });
  assert.deepEqual(parseStatuslineInput('not json'), { sessionId: null, model: null });
  assert.deepEqual(parseStatuslineInput(''), { sessionId: null, model: null });
});

test('buildStatusline finds the session by id and bounds today scanning', async () => {
  const now = new Date(2026, 9, 9, 15, 0);
  const midnight = new Date(2026, 9, 9).getTime();
  const files = [
    { sessionId: 'current', filePath: '/p/a/current.jsonl', mtimeMs: midnight - 1000 },
    ...Array.from({ length: 21 }, (_, i) => ({
      sessionId: `today-${i}`,
      filePath: `/p/b/today-${i}.jsonl`,
      mtimeMs: midnight + 1000 + i,
    })),
  ];
  const parsed = [];
  const parseFile = async (filePath) => {
    parsed.push(filePath);
    const timestamp = filePath.includes('current') ? localIso(2026, 10, 8, 12) : localIso(2026, 10, 9, 10);
    return { usageRecords: [record(timestamp, { model: 'claude-sonnet-5', inputTokens: 1000 })] };
  };

  const line = await buildStatusline(
    { sessionId: 'current', model: null },
    { now, discoverFiles: async () => files, parseFile, loadConfig: () => ({}), color: false },
  );

  assert.equal(parsed.length, 21, '20 newest of today plus the current session');
  assert.ok(parsed.includes('/p/a/current.jsonl'));
  assert.ok(!parsed.includes('/p/b/today-0.jsonl'), 'the oldest of 21 same-day files is skipped');
  assert.match(line, /^◆ (?:<\$0\.01|\$\d+\.\d{2}) session · 1K tok/);
  assert.match(line, /today \$\d+\.\d{2}\+$/, 'today is a lower bound when files were skipped');
});

test('statuslineCommand never throws and prints a neutral line on failure', async () => {
  let output = '';
  const stdout = new Writable({ write(chunk, _encoding, done) { output += chunk; done(); } });
  await statuslineCommand({
    stdin: Readable.from(['{"session_id":"x"}']),
    stdout,
    env: {},
    discoverFiles: async () => { throw new Error('boom'); },
  });
  assert.equal(output, '◆ cc-token-meter: usage unavailable\n');
});

test('statusline flags are exclusive output modes', () => {
  assert.equal(parseArgs(['--statusline']).statusline, true);
  assert.equal(parseArgs(['--statusline-config']).statuslineConfig, true);
  assert.throws(() => parseArgs(['--statusline', '--json']), /choose only one output mode/);
});

test('cc-token-meter --statusline reads a local transcript end to end and writes nothing', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-token-meter-statusline-'));
  try {
    const projectDir = path.join(home, '.claude', 'projects', '-work-demo');
    fs.mkdirSync(projectDir, { recursive: true });
    const sessionId = 'aaaaaaaa-1111-2222-3333-444444444444';
    const assistant = (timestamp, input) => JSON.stringify({
      type: 'assistant',
      sessionId,
      timestamp,
      cwd: '/work/demo',
      message: {
        model: 'claude-sonnet-5',
        usage: { input_tokens: input, output_tokens: 500, cache_read_input_tokens: 3000, cache_creation_input_tokens: 0 },
      },
    });
    fs.writeFileSync(
      path.join(projectDir, `${sessionId}.jsonl`),
      `${assistant(new Date(Date.now() - 60_000).toISOString(), 1000)}\n${assistant(new Date().toISOString(), 1000)}\n`,
    );

    const result = spawnSync(process.execPath, [binPath, '--statusline'], {
      input: JSON.stringify({ session_id: sessionId, model: { id: 'claude-sonnet-5' } }),
      env: { ...process.env, CC_TOKEN_METER_HOME: home, NO_COLOR: '1' },
      encoding: 'utf8',
      timeout: 10_000,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^◆ \$\d+\.\d{2} session · 9K tok · cache 75% · ctx 2% · today \$\d+\.\d{2}\n$/);
    assert.equal(fs.existsSync(path.join(home, '.claude-token-meter')), false, 'statusline must not write local state');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('formatStatusline adds the subscription window segment', () => {
  const base = { session: plainSession(), today: { tokenTotal: 0, costUsd: 1, estimated: false } };
  assert.match(
    formatStatusline({ ...base, planWindow: { tokenTotal: 1_200_000, remainingMinutes: 72 } }),
    / · 5h 1\.2M tok resets 1h12m · today /,
  );
  assert.match(
    formatStatusline({
      ...base,
      config: { blockTokenLimit: 1_500_000 },
      planWindow: { tokenTotal: 1_200_000, remainingMinutes: 9 },
      color: true,
    }),
    /\u001b\[33m5h 80% resets 9m\u001b\[0m/,
  );
  assert.match(formatStatusline({ ...base, planWindow: { idle: true } }), / · 5h idle · /);
});

test('buildStatusline reconstructs the active window from a day of history in plan mode', async () => {
  const now = new Date(2026, 9, 9, 15, 0);
  const files = [{ sessionId: 'current', filePath: '/p/a/current.jsonl', mtimeMs: now.getTime() - 60_000 }];
  // 08:10 opens 08:00–13:00, so 12:50 belongs to it and 13:20 opens 13:00–18:00.
  const parseFile = async () => ({
    usageRecords: [
      record(localIso(2026, 10, 9, 8, 10), { inputTokens: 1000 }),
      record(localIso(2026, 10, 9, 12, 50), { inputTokens: 2000 }),
      record(localIso(2026, 10, 9, 13, 20), { inputTokens: 3000 }),
      record(localIso(2026, 10, 9, 14, 40), { inputTokens: 4000 }),
    ],
  });
  const line = await buildStatusline(
    { sessionId: 'current', model: null },
    { now, discoverFiles: async () => files, parseFile, loadConfig: () => ({ plan: 'max5x' }), color: false },
  );
  assert.match(line, / · 5h 7K tok resets 3h00m · /);

  const apiLine = await buildStatusline(
    { sessionId: 'current', model: null },
    { now, discoverFiles: async () => files, parseFile, loadConfig: () => ({ plan: 'api' }), color: false },
  );
  assert.doesNotMatch(apiLine, /5h/);
});
