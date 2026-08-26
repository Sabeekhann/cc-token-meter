import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchModelRow } from '../src/pricing/cost.js';

const CASES = [
  ['claude-fable-5', 'fable-mythos-5', 10, 50],
  ['claude-mythos-5', 'fable-mythos-5', 10, 50],
  ['claude-opus-5', 'opus-5-and-recent-4x', 5, 25],
  ['claude-opus-4-8', 'opus-5-and-recent-4x', 5, 25],
  ['claude-opus-4-7', 'opus-5-and-recent-4x', 5, 25],
  ['claude-opus-4-6', 'opus-5-and-recent-4x', 5, 25],
  ['claude-opus-4-5-20251101', 'opus-5-and-recent-4x', 5, 25],
  ['claude-opus-4-1-20250805', 'opus-4.1-and-4', 15, 75],
  ['claude-opus-4-20250514', 'opus-4.1-and-4', 15, 75],
  ['claude-3-opus-20240229', 'opus-3', 15, 75],
  ['claude-sonnet-5', 'sonnet-5', 2, 10],
  ['claude-sonnet-4-6', 'sonnet-4x', 3, 15],
  ['claude-sonnet-4-5-20250929', 'sonnet-4x', 3, 15],
  ['claude-sonnet-4-20250514', 'sonnet-4x', 3, 15],
  ['claude-3-7-sonnet-20250219', 'sonnet-3x', 3, 15],
  ['claude-3-5-sonnet-20241022', 'sonnet-3x', 3, 15],
  ['claude-haiku-4-5-20251001', 'haiku-4.5', 1, 5],
  ['claude-3-5-haiku-20241022', 'haiku-3.5', 0.8, 4],
  ['claude-3-haiku-20240307', 'haiku-3', 0.25, 1.25],
];

test('official Claude model identifiers map to their intended pricing families', () => {
  for (const [model, expectedId, expectedInput, expectedOutput] of CASES) {
    const result = matchModelRow(model, '2026-08-26T00:00:00.000Z');
    assert.equal(result.estimated, false, `${model} must not use fallback pricing`);
    assert.equal(result.row.id, expectedId, `${model} pricing family`);
    assert.equal(result.row.inputPerMTok, expectedInput, `${model} input price`);
    assert.equal(result.row.outputPerMTok, expectedOutput, `${model} output price`);
  }
});

test('specific recent Opus identifiers are matched before the broad Opus 4 fallback', () => {
  for (const model of ['claude-opus-4-5-20251101', 'claude-opus-4-6', 'claude-opus-4-8']) {
    const { row } = matchModelRow(model, '2026-08-26T00:00:00.000Z');
    assert.equal(row.id, 'opus-5-and-recent-4x');
    assert.equal(row.inputPerMTok, 5);
    assert.equal(row.outputPerMTok, 25);
  }
});
