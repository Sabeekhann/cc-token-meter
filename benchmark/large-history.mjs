import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createStore } from '../src/ingest/store.js';
import { parseSessionFile } from '../src/ingest/parser.js';
import { RECENT_DETAIL_LIMIT, retainedMessageCount } from '../src/ingest/retention.js';
import { appendSyntheticMessage, writeSyntheticHistory } from './synthetic-history.mjs';

const MIB = 1024 * 1024;
const budgets = {
  coldStartMs: 15_000,
  warmStartMs: 1_500,
  incrementalTailMs: 1_000,
  peakHeapDeltaMiB: 256,
  indexSizeMiB: 24,
};
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-token-meter-benchmark-'));

try {
  const historyDirectory = path.join(temporaryRoot, 'synthetic-history');
  const indexPath = path.join(temporaryRoot, 'usage-index-v3.json');
  const fixture = writeSyntheticHistory(historyDirectory, {
    sessionCount: process.env.CC_TOKEN_METER_BENCHMARK_SESSIONS,
    messageCount: process.env.CC_TOKEN_METER_BENCHMARK_MESSAGES,
  });
  const discoverFiles = async () => fixture.files.map(({ filePath, projectDirName }) => ({
    filePath,
    projectDirName,
  }));

  let coldStore;
  const cold = await measure(async () => {
    coldStore = createStore({ indexPath, discoverFiles });
    await coldStore.ingestNewData();
  });
  assertSnapshot(coldStore.getSnapshot(), fixture.messageCount, fixture.sessionCount);

  let parseCount = 0;
  const countedParser = async (...args) => {
    parseCount += 1;
    return parseSessionFile(...args);
  };
  let warmStore;
  const warm = await measure(async () => {
    warmStore = createStore({ indexPath, discoverFiles, parseFile: countedParser });
    await warmStore.ingestNewData();
  });
  assert.equal(parseCount, 0, 'warm start must not reparse unchanged transcripts');
  assertSnapshot(warmStore.getSnapshot(), fixture.messageCount, fixture.sessionCount);

  appendSyntheticMessage(fixture.files[0], fixture.nextGlobalIndex);
  const incremental = await measure(() => warmStore.ingestNewData());
  assert.equal(parseCount, 1, 'incremental tail must parse only the changed transcript');
  assertSnapshot(warmStore.getSnapshot(), fixture.messageCount + 1, fixture.sessionCount);

  const metrics = {
    fixtureMessages: fixture.messageCount,
    fixtureSessions: fixture.sessionCount,
    recentDetailLimitPerSession: RECENT_DETAIL_LIMIT,
    coldStartMs: round(cold.elapsedMs),
    warmStartMs: round(warm.elapsedMs),
    incrementalTailMs: round(incremental.elapsedMs),
    peakHeapDeltaMiB: round(Math.max(cold.peakHeapDelta, warm.peakHeapDelta) / MIB),
    indexSizeMiB: round(fs.statSync(indexPath).size / MIB),
    warmParseCount: 0,
    incrementalParseCount: parseCount,
    node: process.versions.node,
    platform: `${process.platform}-${process.arch}`,
  };

  enforceBudgets(metrics);
  process.stdout.write(`${JSON.stringify({ budgets, metrics }, null, 2)}\n`);
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

async function measure(operation) {
  global.gc?.();
  const startHeap = process.memoryUsage().heapUsed;
  let peakHeap = startHeap;
  const sampler = setInterval(() => {
    peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
  }, 2);
  const startedAt = performance.now();
  try {
    await operation();
  } finally {
    peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
    clearInterval(sampler);
  }
  return {
    elapsedMs: performance.now() - startedAt,
    peakHeapDelta: Math.max(0, peakHeap - startHeap),
  };
}

function assertSnapshot(snapshot, messageCount, sessionCount) {
  assert.equal(snapshot.totalIngestedMessages, messageCount);
  assert.equal(snapshot.sessions.length, sessionCount);
  assert.equal(
    snapshot.sessions.reduce((sum, session) => sum + session.messageCount, 0),
    messageCount,
  );
  for (const session of snapshot.sessions) {
    assert.ok(session.usageRecords.length <= RECENT_DETAIL_LIMIT);
    assert.equal(retainedMessageCount(session), session.messageCount);
  }
}

function enforceBudgets(metrics) {
  for (const [name, maximum] of Object.entries(budgets)) {
    assert.ok(
      metrics[name] <= maximum,
      `${name} ${metrics[name]} exceeded the documented budget ${maximum}`,
    );
  }
}

function round(value) {
  return Math.round(value * 100) / 100;
}
