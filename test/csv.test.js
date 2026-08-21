import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCsv } from '../src/cli/commands/csv.js';

test('day CSV is stable, numeric, and newline-terminated', () => {
  const csv = buildCsv({
    byDay: [{
      date: '2026-08-21',
      messageCount: 2,
      inputTokens: 100,
      outputTokens: 20,
      cacheCreationInputTokens: 30,
      cacheReadInputTokens: 40,
      tokenTotal: 190,
      costUsd: 0.123456789,
    }],
  }, 'day');

  assert.equal(
    csv,
    'date,messageCount,inputTokens,outputTokens,cacheCreationInputTokens,cacheReadInputTokens,tokenTotal,costUsd\n' +
      '2026-08-21,2,100,20,30,40,190,0.123457\n',
  );
});

test('session CSV escapes private local labels safely without exporting transcript content', () => {
  const csv = buildCsv({
    sessions: [{
      sessionId: 'abc',
      project: '/work/acme, "local"',
      gitBranch: 'feat/export',
      models: ['claude-sonnet-5', 'claude-haiku-5'],
      firstTimestamp: '2026-08-21T10:00:00.000Z',
      lastTimestamp: '2026-08-21T11:00:00.000Z',
      messageCount: 3,
      inputTokens: 100,
      outputTokens: 20,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 50,
      tokenTotal: 170,
      costUsd: 0.04,
      estimatedCostUsed: false,
    }],
  }, 'session');

  assert.match(csv, /"\/work\/acme, ""local"""/);
  assert.match(csv, /claude-sonnet-5\|claude-haiku-5/);
  assert.doesNotMatch(csv, /prompt|toolResult|content/i);
});

test('CSV rejects unsupported grouping instead of silently changing shape', () => {
  assert.throws(() => buildCsv({}, 'model'), /Unsupported CSV group/);
});
