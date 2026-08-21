import assert from 'node:assert/strict';
import test from 'node:test';
import { parseArgs, parseDate } from '../src/cli/index.js';

test('CLI parses private CSV export filters', () => {
  const options = parseArgs([
    '--csv',
    'usage.csv',
    '--group-by',
    'project',
    '--from',
    '2026-08-01',
    '--to',
    '2026-08-21',
    '--project',
    'token-meter',
    '--no-cache',
  ]);

  assert.equal(options.csvPath, 'usage.csv');
  assert.equal(options.groupBy, 'project');
  assert.equal(options.from, '2026-08-01');
  assert.equal(options.to, '2026-08-21');
  assert.equal(options.project, 'token-meter');
  assert.equal(options.cache, false);
});

test('CLI validates ports, real dates, ranges, and group names', () => {
  assert.throws(() => parseArgs(['--port', '70000']), /1 to 65535/);
  assert.throws(() => parseDate('--from', '2026-02-30'), /real calendar date/);
  assert.throws(() => parseArgs(['--from', '2026-08-22', '--to', '2026-08-21']), /must not be after/);
  assert.throws(() => parseArgs(['--group-by', 'model']), /day, project, branch, session/);
});

test('doctor can reuse --json for machine-readable diagnostics', () => {
  const options = parseArgs(['--doctor', '--json']);
  assert.equal(options.doctor, true);
  assert.equal(options.json, true);
});

test('compact summary supports filters and rejects ambiguous output modes', () => {
  const options = parseArgs(['--summary', '--from', '2026-08-01', '--project', 'meter']);
  assert.equal(options.summary, true);
  assert.equal(options.project, 'meter');
  assert.throws(
    () => parseArgs(['--summary', '--json']),
    /choose only one output mode/,
  );
});
