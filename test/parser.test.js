import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
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
  assert.equal(secondHalf.newOffset, firstHalf.newOffset);
});

test('handles multi-model session file correctly', async () => {
  const filePath = path.join(FIXTURES_DIR, 'multi-model-session.jsonl');
  const result = await parseSessionFile(filePath);

  assert.equal(result.usageRecords.length, 3);
  const models = result.usageRecords.map((r) => r.model);
  assert.deepEqual(models, ['claude-sonnet-5', 'claude-opus-4-5', 'claude-haiku-4-5']);
});
