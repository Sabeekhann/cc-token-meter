import assert from 'node:assert/strict';
import test from 'node:test';
import { handleApiRoute, parseSummaryQuery } from '../src/server/routes.js';

function createResponseCapture() {
  return {
    statusCode: null,
    headers: null,
    body: '',
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body = '') {
      this.body += body;
    },
  };
}

function emptyStore() {
  return {
    getSnapshot() {
      return { sessions: [], totalIngestedMessages: 0 };
    },
  };
}

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
    () => parseSummaryQuery(new URL('http://127.0.0.1/api/summary?from=not-a-date')),
    /YYYY-MM-DD/,
  );
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
  const oversizedProject = 'p'.repeat(1025);
  assert.throws(
    () => parseSummaryQuery(new URL(`http://127.0.0.1/api/summary?project=${oversizedProject}`)),
    /maximum length of 1024/,
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

test('GET /api/summary returns a filtered local summary for valid query parameters', async () => {
  const req = { method: 'GET' };
  const res = createResponseCapture();
  const url = new URL('http://127.0.0.1:4317/api/summary?model=claude-sonnet-5&project=alpha');

  const handled = await handleApiRoute(req, res, url, emptyStore());

  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'application/json; charset=utf-8');
  const payload = JSON.parse(res.body);
  assert.deepEqual(payload.filters, {
    from: null,
    to: null,
    project: 'alpha',
    model: 'claude-sonnet-5',
  });
  assert.equal(payload.totalIngestedMessages, 0);
});

test('GET /api/summary returns 400 for invalid filter input without reading store data', async () => {
  let snapshotReads = 0;
  const store = {
    getSnapshot() {
      snapshotReads += 1;
      return { sessions: [], totalIngestedMessages: 0 };
    },
  };
  const req = { method: 'GET' };
  const res = createResponseCapture();
  const url = new URL('http://127.0.0.1:4317/api/summary?from=2026-08-28&to=2026-08-27');

  const handled = await handleApiRoute(req, res, url, store);

  assert.equal(handled, true);
  assert.equal(res.statusCode, 400);
  assert.equal(snapshotReads, 0);
  const payload = JSON.parse(res.body);
  assert.equal(payload.error, 'Invalid summary filters');
  assert.match(payload.detail, /must not be after/);
});
