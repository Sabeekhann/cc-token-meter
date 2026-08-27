import assert from 'node:assert/strict';
import test from 'node:test';
import { parseArgs } from '../src/cli/index.js';

test('CLI rejects unknown flags instead of silently ignoring typos', () => {
  assert.throws(() => parseArgs(['--summry']), /unknown argument: --summry/);
  assert.throws(() => parseArgs(['unexpected-positional']), /unknown argument: unexpected-positional/);
});

test('known flags continue to parse normally', () => {
  const parsed = parseArgs([
    '--summary',
    '--no-cache',
    '--from',
    '2026-08-01',
    '--model',
    'claude-sonnet-5',
  ]);
  assert.equal(parsed.summary, true);
  assert.equal(parsed.cache, false);
  assert.equal(parsed.from, '2026-08-01');
  assert.equal(parsed.model, 'claude-sonnet-5');
});

test('model filtering requires an explicit model identifier value', () => {
  assert.throws(() => parseArgs(['--summary', '--model']), /--model requires a value/);
  assert.throws(() => parseArgs(['--summary', '--model', '--json']), /--model requires a value/);
});
