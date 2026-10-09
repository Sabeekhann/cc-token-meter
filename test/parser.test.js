import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseSessionFile } from '../src/ingest/parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, 'fixtures');

test('parses a well-formed session file, ignoring unknown line types', async () => {
  const filePath = path.join(FIXTURES_DIR, 'simple-session.jsonl');
  const result = await parseSessionFile(filePath);

  // 3 assistant lines in the fixture.
  assert.equal(result.usageRecords.length, 3);
  // 1 tool_use (Read) event.
  assert.equal(result.toolUseEvents.length, 1);
  assert.equal(result.toolUseEvents[0].name, 'Read');
  assert.equal(result.toolUseEvents[0].filePath, '/Users/dev/project-a/src/index.js');
  // 1 tool_result event.
  assert.equal(result.toolResultEvents.length, 1);
  assert.equal(result.toolResultEvents[0].toolUseId, 'toolu_abc123');
  assert.ok(result.toolResultEvents[0].contentByteLength > 0);
  assert.equal(result.compactDetected, false);
  assert.equal(result.compactDetectionComplete, true);

  // Offset should equal the full file size (all lines consumed).
  const stat = fs.statSync(filePath);
  assert.equal(result.newOffset, stat.size);

  // Sanity-check normalized fields on first record.
  const first = result.usageRecords[0];
  assert.equal(first.model, 'claude-sonnet-5');
  assert.equal(first.inputTokens, 1000);
  assert.equal(first.outputTokens, 200);
  assert.equal(first.cacheWrite1h, 500);
  assert.equal(first.projectCwd, '/Users/dev/project-a');
  assert.equal(first.gitBranch, 'main');
});

test('skips malformed non-trailing lines and continues parsing', async () => {
  const filePath = path.join(FIXTURES_DIR, 'malformed-lines.jsonl');
  const result = await parseSessionFile(filePath);

  // 2 valid assistant lines; the garbage line in between is skipped.
  assert.equal(result.usageRecords.length, 2);
  assert.equal(result.usageRecords[0].inputTokens, 100);
  assert.equal(result.usageRecords[1].inputTokens, 200);

  // Offset should reach end of file since the malformed line was in the
  // middle, not the trailing line.
  const stat = fs.statSync(filePath);
  assert.equal(result.newOffset, stat.size);
});

test('does not advance offset past a partial/incomplete trailing line', async () => {
  const filePath = path.join(FIXTURES_DIR, 'partial-last-line.jsonl');
  const result = await parseSessionFile(filePath);

  // 2 complete assistant lines; the 3rd is truncated mid-JSON.
  assert.equal(result.usageRecords.length, 2);

  const stat = fs.statSync(filePath);
  assert.ok(result.newOffset < stat.size, 'offset should not reach EOF since trailing line is incomplete');

  // Re-parsing from the returned offset with the SAME (still-incomplete)
  // file should yield zero new records and the same offset (idempotent).
  const second = await parseSessionFile(filePath, { startOffset: result.newOffset });
  assert.equal(second.usageRecords.length, 0);
  assert.equal(second.newOffset, result.newOffset);
});

test('supports incremental tailing via startOffset', async () => {
  const filePath = path.join(FIXTURES_DIR, 'simple-session.jsonl');
  const firstHalf = await parseSessionFile(filePath, { startOffset: 0 });

  // Now "tail" from the offset reached — should yield 0 additional records
  // since the file didn't change.
  const secondHalf = await parseSessionFile(filePath, { startOffset: firstHalf.newOffset });
  assert.equal(secondHalf.usageRecords.length, 0);
  assert.equal(secondHalf.compactDetected, false);
  assert.equal(secondHalf.compactDetectionComplete, false);
  assert.equal(secondHalf.newOffset, firstHalf.newOffset);
});

test('detects a compact-boundary event without retaining transcript content', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-token-meter-compact-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, 'session.jsonl');
  const lines = [
    JSON.stringify({
      type: 'system',
      subtype: 'compact_boundary',
      sessionId: 'session',
      content: 'Conversation compacted',
    }),
  ];
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');

  const result = await parseSessionFile(filePath);

  assert.equal(result.compactDetected, true);
  assert.equal(result.compactDetectionComplete, true);
  assert.equal('rawLines' in result, false);
});

test('tracks exact byte offsets for CRLF-authored JSONL', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-token-meter-crlf-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, 'session.jsonl');
  const source = fs.readFileSync(path.join(FIXTURES_DIR, 'simple-session.jsonl'), 'utf8');
  const crlfSource = source.replace(/\r?\n/g, '\r\n');
  fs.writeFileSync(filePath, crlfSource, 'utf8');

  const first = await parseSessionFile(filePath);
  assert.equal(first.usageRecords.length, 3);
  assert.equal(first.newOffset, Buffer.byteLength(crlfSource, 'utf8'));

  const second = await parseSessionFile(filePath, { startOffset: first.newOffset });
  assert.equal(second.usageRecords.length, 0);
  assert.equal(second.newOffset, first.newOffset);
});

test('consumes a valid final JSONL record without inventing a newline byte', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-token-meter-no-eol-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, 'session.jsonl');
  const source = fs.readFileSync(path.join(FIXTURES_DIR, 'simple-session.jsonl'), 'utf8').trimEnd();
  fs.writeFileSync(filePath, source, 'utf8');

  const result = await parseSessionFile(filePath);
  assert.equal(result.usageRecords.length, 3);
  assert.equal(result.newOffset, Buffer.byteLength(source, 'utf8'));
});

test('handles multi-model session file correctly', async () => {
  const filePath = path.join(FIXTURES_DIR, 'multi-model-session.jsonl');
  const result = await parseSessionFile(filePath);

  assert.equal(result.usageRecords.length, 3);
  const models = result.usageRecords.map((r) => r.model);
  assert.deepEqual(models, ['claude-sonnet-5', 'claude-opus-4-5', 'claude-haiku-4-5']);
});

// split-response-session.jsonl mirrors how current Claude Code versions write
// one API response as several assistant lines (one per content block), each
// repeating the response's full usage, plus a finished-subagent tool_result.
test('counts usage once per API response even when it spans several block lines', async () => {
  const result = await parseSessionFile(path.join(FIXTURES_DIR, 'split-response-session.jsonl'));

  assert.equal(result.usageRecords.length, 2, 'two responses, five assistant lines');
  assert.deepEqual(result.usageRecords.map((r) => r.outputTokens), [100, 200]);
  assert.deepEqual(
    result.toolUseEvents.map((e) => e.name),
    ['Task', 'mcp__github__get_file', 'Read'],
    'tool_use blocks are still read from every line',
  );
  assert.deepEqual(result.recentMessageKeys, ['msg_split_1:req_split_1', 'msg_split_2:req_split_2']);
});

test('a response split across incremental reads is not counted twice', async () => {
  const filePath = path.join(FIXTURES_DIR, 'split-response-session.jsonl');
  const raw = fs.readFileSync(filePath);
  // Stop after the first block line of response 2.
  let cut = 0;
  for (let i = 0; i < 5; i += 1) cut = raw.indexOf(0x0a, cut) + 1;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-token-meter-split-'));
  const tmpFile = path.join(tmpDir, 'session.jsonl');
  try {
    fs.writeFileSync(tmpFile, raw.subarray(0, cut));
    const first = await parseSessionFile(tmpFile);
    assert.equal(first.usageRecords.length, 2);

    fs.writeFileSync(tmpFile, raw);
    const second = await parseSessionFile(tmpFile, {
      startOffset: first.newOffset,
      seenMessageKeys: first.recentMessageKeys,
    });
    assert.equal(second.usageRecords.length, 0, 'remaining lines repeat response 2');
    assert.equal(second.toolUseEvents.length, 2);

    const withoutKeys = await parseSessionFile(tmpFile, { startOffset: first.newOffset });
    assert.equal(withoutKeys.usageRecords.length, 1, 'without carried keys the repeat would count again');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('reports finished subagents by id and type without reading their prompt or report', async () => {
  const result = await parseSessionFile(path.join(FIXTURES_DIR, 'split-response-session.jsonl'));
  assert.deepEqual(result.subagentEvents, [{
    agentId: 'a1b2c3',
    agentType: 'Explore',
    toolUseId: 'toolu_split_1',
    timestamp: '2026-10-01T10:00:30.000Z',
  }]);
  assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC-PROMPT-MUST-NOT-BE-READ/);
});

test('assistant lines without a message id each still count', async () => {
  const result = await parseSessionFile(path.join(FIXTURES_DIR, 'simple-session.jsonl'));
  assert.equal(result.usageRecords.length, 3);
});
