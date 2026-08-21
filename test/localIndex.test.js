import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  LOCAL_INDEX_VERSION,
  readLocalIndex,
  writeLocalIndex,
} from '../src/ingest/localIndex.js';

test('local index round-trips atomically and uses owner-only file permissions', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-token-meter-index-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const indexPath = path.join(dir, 'usage-index.json');

  writeLocalIndex(
    {
      totalIngestedMessages: 2,
      sessions: [{ sessionId: 's1', models: ['claude-sonnet-5'], usageRecords: [] }],
      files: [{ filePath: '/tmp/s1.jsonl', offset: 123, sessionIds: ['s1'] }],
    },
    indexPath
  );

  const restored = readLocalIndex(indexPath);
  assert.equal(restored.version, LOCAL_INDEX_VERSION);
  assert.equal(restored.totalIngestedMessages, 2);
  assert.equal(restored.sessions[0].sessionId, 's1');
  assert.equal(restored.files[0].offset, 123);

  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(indexPath).mode & 0o777, 0o600);
  }
});

test('local index ignores corrupt and unsupported versions', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-token-meter-index-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const indexPath = path.join(dir, 'usage-index.json');

  fs.writeFileSync(indexPath, '{broken', 'utf8');
  assert.equal(readLocalIndex(indexPath), null);

  fs.writeFileSync(
    indexPath,
    JSON.stringify({ version: 999, sessions: [], files: [], totalIngestedMessages: 0 }),
    'utf8'
  );
  assert.equal(readLocalIndex(indexPath), null);
});
