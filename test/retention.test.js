import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildUsageIntelligence } from '../src/analytics/overview.js';
import { filterSessions } from '../src/analytics/filters.js';
import {
  aggregateByBranch,
  aggregateByDay,
  aggregateByProject,
} from '../src/ingest/aggregate.js';
import { createStore } from '../src/ingest/store.js';
import { parseSessionFile } from '../src/ingest/parser.js';
import {
  compactSessionHistory,
  RECENT_DETAIL_LIMIT,
  retainedMessageCount,
} from '../src/ingest/retention.js';
import { writeSyntheticHistory } from '../benchmark/synthetic-history.mjs';

test('large-history fixtures are deterministic and contain usage metadata only', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-token-meter-generator-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const left = writeSyntheticHistory(path.join(root, 'left'), { sessionCount: 2, messageCount: 7 });
  const right = writeSyntheticHistory(path.join(root, 'right'), { sessionCount: 2, messageCount: 7 });

  for (let index = 0; index < left.files.length; index += 1) {
    const leftText = fs.readFileSync(left.files[index].filePath, 'utf8');
    const rightText = fs.readFileSync(right.files[index].filePath, 'utf8');
    assert.equal(leftText, rightText);
    assert.doesNotMatch(leftText, /prompt|tool_use|tool_result|username/i);
    for (const line of leftText.trim().split('\n')) {
      const parsed = JSON.parse(line);
      assert.equal(parsed.type, 'assistant');
      assert.deepEqual(parsed.message.content, []);
      assert.match(parsed.cwd, /^\/synthetic\/workspace\/project-/);
    }
  }
});

test('bounded detail preserves session, project, branch, day, and intelligence totals', () => {
  const records = Array.from({ length: 8 }, (_, index) => usageRecord(index));
  const before = makeSession(records);
  const after = compactSessionHistory(before, { detailLimit: 3 });

  assert.equal(after.usageRecords.length, 3);
  assert.equal(retainedMessageCount(after), 8);
  assert.ok(after.dailyRollups.length > 0);
  assert.deepEqual(sessionTotals(after), sessionTotals(before));
  assert.deepEqual(dayTotals(after), dayTotals(before));
  assert.deepEqual(branchTotals(after), branchTotals(before));
  assert.deepEqual(projectTotals(after), projectTotals(before));

  const beforeFiltered = filterSessions([before], { from: '2026-08-01', to: '2026-08-01' });
  const afterFiltered = filterSessions([after], { from: '2026-08-01', to: '2026-08-01' });
  assert.deepEqual(sessionTotals(afterFiltered[0]), sessionTotals(beforeFiltered[0]));

  const beforeIntelligence = buildUsageIntelligence([before], { now: '2026-08-03T00:00:00.000Z' });
  const afterIntelligence = buildUsageIntelligence([after], { now: '2026-08-03T00:00:00.000Z' });
  assert.deepEqual(afterIntelligence.cache, beforeIntelligence.cache);
  assert.deepEqual(afterIntelligence.models, beforeIntelligence.models);
  assert.deepEqual(afterIntelligence.dataQuality, beforeIntelligence.dataQuality);
});

test('a v2 index migrates warm to bounded v3 without reparsing unchanged transcripts', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-token-meter-migration-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const transcript = path.join(dir, 'session-1.jsonl');
  const records = Array.from({ length: RECENT_DETAIL_LIMIT + 5 }, (_, index) => usageRecord(index));
  fs.writeFileSync(transcript, `${records.map(assistantLine).join('\n')}\n`, 'utf8');
  const stat = fs.statSync(transcript);
  const v2Path = path.join(dir, 'usage-index-v2.json');
  const v3Path = path.join(dir, 'usage-index-v3.json');

  fs.writeFileSync(v2Path, JSON.stringify({
    version: 2,
    writtenAt: '2026-08-01T00:00:00.000Z',
    totalIngestedMessages: records.length + 99,
    sessions: [{ ...makeSession(records), models: ['claude-sonnet-5', 'claude-haiku-4'] }],
    files: [{
      filePath: transcript,
      offset: stat.size,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      projectDirName: '-synthetic-project',
      sessionIds: ['session-1'],
    }],
  }), 'utf8');

  let parseCount = 0;
  const store = createStore({
    indexPath: v3Path,
    discoverFiles: async () => [{ filePath: transcript, projectDirName: '-synthetic-project' }],
    parseFile: async () => {
      parseCount += 1;
      throw new Error('unchanged v2 transcript must not be reparsed');
    },
  });
  await store.ingestNewData();

  const snapshot = store.getSnapshot();
  assert.equal(parseCount, 0);
  assert.equal(snapshot.totalIngestedMessages, records.length);
  assert.equal(snapshot.sessions[0].usageRecords.length, RECENT_DETAIL_LIMIT);
  assert.equal(retainedMessageCount(snapshot.sessions[0]), records.length);
  assert.equal(JSON.parse(fs.readFileSync(v3Path, 'utf8')).version, 3);
});

test('--no-cache behavior keeps exact totals, bounds memory, and writes no index', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-token-meter-no-cache-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const transcript = path.join(dir, 'session-1.jsonl');
  const indexPath = path.join(dir, 'must-not-exist.json');
  const records = Array.from({ length: RECENT_DETAIL_LIMIT + 3 }, (_, index) => usageRecord(index));
  fs.writeFileSync(transcript, `${records.map(assistantLine).join('\n')}\n`, 'utf8');

  const store = createStore({
    persistIndex: false,
    indexPath,
    discoverFiles: async () => [{ filePath: transcript, projectDirName: '-synthetic-project' }],
  });
  await store.ingestNewData();

  const snapshot = store.getSnapshot();
  assert.equal(snapshot.totalIngestedMessages, records.length);
  assert.equal(snapshot.sessions[0].messageCount, records.length);
  assert.equal(snapshot.sessions[0].usageRecords.length, RECENT_DETAIL_LIMIT);
  assert.equal(retainedMessageCount(snapshot.sessions[0]), records.length);
  assert.equal(fs.existsSync(indexPath), false);
});

test('deleting the private index triggers a clean transcript rebuild', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-token-meter-rebuild-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const transcript = path.join(dir, 'session-1.jsonl');
  const indexPath = path.join(dir, 'usage-index-v3.json');
  const records = Array.from({ length: 6 }, (_, index) => usageRecord(index));
  fs.writeFileSync(transcript, `${records.map(assistantLine).join('\n')}\n`, 'utf8');
  const discoverFiles = async () => [{ filePath: transcript, projectDirName: '-synthetic-project' }];

  const first = createStore({ indexPath, discoverFiles });
  await first.ingestNewData();
  assert.equal(fs.existsSync(indexPath), true);
  fs.rmSync(indexPath);

  let parseCount = 0;
  const rebuilt = createStore({
    indexPath,
    discoverFiles,
    parseFile: async (...args) => {
      parseCount += 1;
      return parseSessionFile(...args);
    },
  });
  await rebuilt.ingestNewData();

  assert.equal(parseCount, 1);
  assert.equal(rebuilt.getSnapshot().totalIngestedMessages, records.length);
  assert.equal(rebuilt.getSnapshot().sessions[0].messageCount, records.length);
  assert.equal(JSON.parse(fs.readFileSync(indexPath, 'utf8')).version, 3);
});

function usageRecord(index) {
  const branch = index % 2 === 0 ? 'main' : 'feature/bounded-history';
  const model = index % 3 === 0 ? 'claude-haiku-4' : 'claude-sonnet-5';
  const timestamp = new Date(
    Date.UTC(2026, 7, 1, 12) + Math.floor(index / 4) * 86_400_000 + (index % 4) * 60_000,
  ).toISOString();
  return {
    sessionId: 'session-1',
    projectCwd: '/synthetic/project',
    timestamp,
    model,
    inputTokens: 100 + index,
    outputTokens: 20 + index,
    cacheCreationInputTokens: 10,
    cacheReadInputTokens: 30,
    cacheWrite5m: 5,
    cacheWrite1h: 5,
    gitBranch: branch,
    version: '2.1.0',
    costUsd: 0.01 + index / 1000,
    estimatedCostUsed: index % 3 === 0,
  };
}

function makeSession(records) {
  const totals = records.reduce((acc, record) => {
    for (const field of [
      'inputTokens',
      'outputTokens',
      'cacheCreationInputTokens',
      'cacheReadInputTokens',
      'cacheWrite5m',
      'cacheWrite1h',
      'costUsd',
    ]) acc[field] += record[field];
    return acc;
  }, {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    costUsd: 0,
  });
  return {
    sessionId: 'session-1',
    projectCwd: '/synthetic/project',
    projectDirNameFallback: null,
    models: [...new Set(records.map((record) => record.model))],
    firstTimestamp: records[0].timestamp,
    lastTimestamp: records[records.length - 1].timestamp,
    messageCount: records.length,
    ...totals,
    estimatedCostUsed: records.some((record) => record.estimatedCostUsed),
    gitBranch: records[records.length - 1].gitBranch,
    version: '2.1.0',
    dailyRollups: [],
    usageRecords: records,
    toolEvents: [],
  };
}

function assistantLine(record) {
  return JSON.stringify({
    type: 'assistant',
    sessionId: record.sessionId,
    timestamp: record.timestamp,
    cwd: record.projectCwd,
    gitBranch: record.gitBranch,
    version: record.version,
    message: {
      model: record.model,
      content: [],
      usage: {
        input_tokens: record.inputTokens,
        output_tokens: record.outputTokens,
        cache_creation_input_tokens: record.cacheCreationInputTokens,
        cache_read_input_tokens: record.cacheReadInputTokens,
      },
    },
  });
}

function sessionTotals(session) {
  return numericProjection(session, ['messageCount']);
}

function dayTotals(session) {
  return aggregateByDay([session]).map((day) => numericProjection(day, ['date']));
}

function branchTotals(session) {
  return aggregateByBranch([session]).map((branch) => numericProjection(branch, ['branch']));
}

function projectTotals(session) {
  return aggregateByProject([session]).map((project) => numericProjection(project, ['project']));
}

function numericProjection(value, identityFields) {
  const result = Object.fromEntries(identityFields.map((field) => [field, value[field]]));
  for (const field of [
    'inputTokens',
    'outputTokens',
    'cacheCreationInputTokens',
    'cacheReadInputTokens',
    'costUsd',
    'tokenTotal',
  ]) result[field] = Number((value[field] || 0).toFixed(12));
  return result;
}
