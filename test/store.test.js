import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../src/ingest/store.js';
import { parseSessionFile } from '../src/ingest/parser.js';
import { buildSummary } from '../src/server/summary.js';
import { fileURLToPath } from 'node:url';
import { localDateKey } from '../src/ingest/aggregate.js';

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

function assistantLine({ sessionId, timestamp, inputTokens }) {
  return JSON.stringify({
    type: 'assistant',
    sessionId,
    timestamp,
    cwd: '/work/project',
    gitBranch: 'main',
    version: '2.1.0',
    message: {
      model: 'claude-sonnet-5',
      content: [],
      usage: {
        input_tokens: inputTokens,
        output_tokens: 10,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  });
}

function compactBoundaryLine(sessionId = 'session-1') {
  return JSON.stringify({
    type: 'system',
    subtype: 'compact_boundary',
    sessionId,
    content: 'Conversation compacted',
  });
}

function tempSession(t, lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-token-meter-store-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, 'session-1.jsonl');
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
  return { dir, filePath };
}

function discoverOnly(filePath) {
  return async () => {
    const stat = fs.statSync(filePath);
    return [
      {
        sessionId: 'session-1',
        projectDirName: '-work-project',
        filePath,
        mtimeMs: stat.mtimeMs,
        size: stat.size,
      },
    ];
  };
}

test('store restores an unchanged transcript from the local index without reparsing', async (t) => {
  const line = assistantLine({
    sessionId: 'session-1',
    timestamp: '2026-08-21T12:00:00.000Z',
    inputTokens: 100,
  });
  const { dir, filePath } = tempSession(t, [line]);
  const indexPath = path.join(dir, 'usage-index.json');
  let parseCount = 0;
  const countedParser = async (...args) => {
    parseCount += 1;
    return parseSessionFile(...args);
  };

  const first = createStore({
    indexPath,
    discoverFiles: discoverOnly(filePath),
    parseFile: countedParser,
  });
  await first.ingestNewData();
  assert.equal(parseCount, 1);
  assert.equal(first.getSnapshot().sessions[0].messageCount, 1);
  assert.equal(first.getSnapshot().sessions[0].compactDetected, false);

  const second = createStore({
    indexPath,
    discoverFiles: discoverOnly(filePath),
    parseFile: countedParser,
  });
  await second.ingestNewData();

  assert.equal(parseCount, 1, 'second store should trust the unchanged indexed offset');
  assert.equal(second.getSnapshot().sessions[0].messageCount, 1);
  assert.deepEqual(second.getSnapshot().sessions[0].models, ['claude-sonnet-5']);
  assert.equal(second.getSnapshot().sessions[0].compactDetected, false);
});

test('store carries compact detection from streaming ingestion into the session aggregate', async (t) => {
  const line = assistantLine({
    sessionId: 'session-1',
    timestamp: '2026-08-21T12:00:00.000Z',
    inputTokens: 100,
  });
  const { filePath } = tempSession(t, [line, compactBoundaryLine()]);
  const store = createStore({
    persistIndex: false,
    discoverFiles: discoverOnly(filePath),
  });

  await store.ingestNewData();

  assert.equal(store.getSnapshot().sessions[0].compactDetected, true);
});

test('summary suppresses the long-session warning after an ingested compact event', async (t) => {
  const start = Date.parse('2026-08-21T12:00:00.000Z');
  const lines = Array.from({ length: 60 }, (_, index) => assistantLine({
    sessionId: 'session-1',
    timestamp: new Date(start + index * 60_000).toISOString(),
    inputTokens: 100,
  }));
  lines.splice(30, 0, compactBoundaryLine());
  const { filePath } = tempSession(t, lines);
  const store = createStore({
    persistIndex: false,
    discoverFiles: discoverOnly(filePath),
  });

  await store.ingestNewData();
  const summary = buildSummary(store, {
    config: {
      dailyTokenCap: null,
      dailyCostCapUsd: null,
      sessionTokenCap: null,
      sessionCostCapUsd: null,
      warnThresholdPct: 80,
    },
  });

  assert.equal(
    summary.tips.some((tip) => tip.id.startsWith('longSessionNoCompact:')),
    false,
  );
});

test('store carries full-scan evidence across later incremental tails without creating empty sessions', async (t) => {
  const { filePath } = tempSession(t, []);
  const store = createStore({
    persistIndex: false,
    discoverFiles: discoverOnly(filePath),
  });

  await store.ingestNewData();
  assert.equal(store.getSnapshot().sessions.length, 0);

  const line = assistantLine({
    sessionId: 'session-1',
    timestamp: '2026-08-21T12:00:00.000Z',
    inputTokens: 100,
  });
  fs.appendFileSync(filePath, `${line}\n`, 'utf8');
  await store.ingestNewData();

  assert.equal(store.getSnapshot().sessions[0].compactDetected, false);
});

test('store rebuilds a truncated transcript instead of double-counting old records', async (t) => {
  const firstLine = assistantLine({
    sessionId: 'session-1',
    timestamp: '2026-08-21T12:00:00.000Z',
    inputTokens: 100,
  });
  const secondLine = assistantLine({
    sessionId: 'session-1',
    timestamp: '2026-08-21T12:01:00.000Z',
    inputTokens: 200,
  });
  const { filePath } = tempSession(t, [firstLine, secondLine]);
  const store = createStore({
    persistIndex: false,
    discoverFiles: discoverOnly(filePath),
  });

  await store.ingestNewData();
  assert.equal(store.getSnapshot().sessions[0].messageCount, 2);
  assert.equal(store.getSnapshot().totalIngestedMessages, 2);

  fs.writeFileSync(filePath, `${firstLine}\n`, 'utf8');
  await store.ingestNewData();

  const rebuilt = store.getSnapshot().sessions[0];
  assert.equal(rebuilt.messageCount, 1);
  assert.equal(rebuilt.inputTokens, 100);
  assert.equal(store.getSnapshot().totalIngestedMessages, 1);
});

test('store rebuilds a replaced transcript with the same size instead of double-counting', async (t) => {
  const original = assistantLine({
    sessionId: 'session-1',
    timestamp: '2026-08-21T12:00:00.000Z',
    inputTokens: 100,
  });
  const replacement = assistantLine({
    sessionId: 'session-1',
    timestamp: '2026-08-21T12:00:00.000Z',
    inputTokens: 900,
  });
  assert.equal(Buffer.byteLength(original), Buffer.byteLength(replacement));
  const { dir, filePath } = tempSession(t, [original]);
  const store = createStore({
    persistIndex: false,
    discoverFiles: discoverOnly(filePath),
  });

  await store.ingestNewData();
  const originalRevision = store.getSnapshot().revision;
  const replacementPath = path.join(dir, 'replacement.jsonl');
  fs.writeFileSync(replacementPath, `${replacement}\n`, 'utf8');
  fs.renameSync(replacementPath, filePath);
  await store.ingestNewData();

  const snapshot = store.getSnapshot();
  assert.ok(snapshot.revision > originalRevision);
  assert.equal(snapshot.totalIngestedMessages, 1);
  assert.equal(snapshot.sessions[0].messageCount, 1);
  assert.equal(snapshot.sessions[0].inputTokens, 900);
});

test('subagent transcripts get their own linked aggregate and tools are attributed exactly', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-token-meter-subagents-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const parentId = '22222222-2222-2222-2222-222222222222';
  const parentFile = path.join(dir, `${parentId}.jsonl`);
  fs.copyFileSync(path.join(FIXTURES_DIR, 'split-response-session.jsonl'), parentFile);
  const agentFile = path.join(dir, parentId, 'subagents', 'agent-a1b2c3.jsonl');
  fs.mkdirSync(path.dirname(agentFile), { recursive: true });
  const agentLine = (block) => JSON.stringify({
    type: 'assistant',
    sessionId: parentId,
    agentId: 'a1b2c3',
    isSidechain: true,
    timestamp: '2026-10-01T10:00:20.000Z',
    cwd: '/Users/dev/project-split',
    requestId: 'req_agent_1',
    message: {
      model: 'claude-haiku-4-5',
      id: 'msg_agent_1',
      content: [{ type: 'text', text: 'synthetic' }],
      usage: { input_tokens: 5, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 500 },
    },
    apiBlockIndex: block,
  });
  fs.writeFileSync(agentFile, `${agentLine(0)}\n${agentLine(1)}\n`);

  const discoverFiles = async () => [
    { filePath: parentFile, projectDirName: '-project-split', sessionId: parentId },
    {
      filePath: agentFile,
      projectDirName: '-project-split',
      sessionId: `${parentId}:agent-a1b2c3`,
      agentId: 'a1b2c3',
      parentSessionId: parentId,
    },
  ];
  const store = createStore({ persistIndex: false, discoverFiles });
  await store.ingestNewData();

  const byId = Object.fromEntries(store.getSnapshot().sessions.map((s) => [s.sessionId, s]));
  const parent = byId[parentId];
  const agent = byId[`${parentId}:agent-a1b2c3`];

  assert.equal(parent.messageCount, 2);
  assert.equal(parent.parentSessionId, null);
  assert.deepEqual(parent.subagentTypes, { a1b2c3: 'Explore' });
  const day = localDateKey('2026-10-01T10:00:05.000Z');
  assert.deepEqual(Object.keys(parent.toolStatsByDay), [day]);
  assert.deepEqual(parent.toolStatsByDay[day].Task, { calls: 1, resultBytes: Buffer.byteLength(JSON.stringify('synthetic report')) });
  assert.deepEqual(parent.toolStatsByDay[day].mcp__github__get_file, { calls: 1, resultBytes: 0 });
  assert.equal(parent.usageRecords.some((record) => 'messageKey' in record), false, 'dedupe keys are not persisted');

  assert.equal(agent.messageCount, 1, 'subagent block lines are deduplicated too');
  assert.equal(agent.parentSessionId, parentId);
  assert.equal(agent.agentId, 'a1b2c3');
  assert.equal(agent.outputTokens, 50);
  assert.equal(agent.projectCwd, '/Users/dev/project-split');
  assert.equal(store.getSnapshot().totalIngestedMessages, 3);

  // Replacing the subagent transcript rebuilds only the subagent aggregate.
  fs.rmSync(agentFile);
  fs.writeFileSync(agentFile, `${agentLine(0)}\n`);
  await store.ingestNewData();
  const after = Object.fromEntries(store.getSnapshot().sessions.map((s) => [s.sessionId, s]));
  assert.equal(after[parentId].messageCount, 2);
  assert.equal(after[`${parentId}:agent-a1b2c3`].messageCount, 1);
});
