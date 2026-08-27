import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSummaryQuery } from '../src/server/routes.js';

test('summary query parses the explicit local analysis filter allowlist', () => {
  const filters = parseSummaryQuery(new URL(
    'http://127.0.0.1:4317/api/summary?from=2026-08-01&to=2026-08-27&project=%20alpha%20&model=%20claude-sonnet-5%20&ignored=value',
  ));

  assert.deepEqual(filters, {
    from: '2026-08-01',
    to: '2026-08-27',
    project: 'alpha',
    model: 'claude-sonnet-5',
  });
});

test('summary query rejects invalid calendar dates and inverted ranges', () => {
  assert.throws(
    () => parseSummaryQuery(new URL('http://127.0.0.1/api/summary?from=2026-02-30')),
    /real calendar date/,
  );
  assert.throws(
    () => parseSummaryQuery(new URL('http://127.0.0.1/api/summary?from=2026-08-28&to=2026-08-27')),
    /must not be after/,
  );
});

test('summary query rejects duplicate or oversized filter values', () => {
  assert.throws(
    () => parseSummaryQuery(new URL('http://127.0.0.1/api/summary?model=a&model=b')),
    /model must be provided at most once/,
  );
  const oversizedModel = 'm'.repeat(257);
  assert.throws(
    () => parseSummaryQuery(new URL(`http://127.0.0.1/api/summary?model=${oversizedModel}`)),
    /maximum length of 256/,
  );
});

test('summary query normalizes absent and blank filters to null', () => {
  assert.deepEqual(parseSummaryQuery(new URL('http://127.0.0.1/api/summary?model=%20%20')), {
    from: null,
    to: null,
    project: null,
    model: null,
  });
});
