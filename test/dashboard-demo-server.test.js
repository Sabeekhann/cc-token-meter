import assert from 'node:assert/strict';
import test from 'node:test';
import { createDashboardDemoServer } from './dashboard-demo-server.js';
import {
  DASHBOARD_DEMO_MODELS,
  demoLocalDate,
} from './fixtures/dashboard-sessions.js';

const FIXED_NOW = new Date('2026-08-28T12:00:00.000Z');

test('synthetic dashboard preview exercises real date, project, and model filters', async (t) => {
  const server = createDashboardDemoServer({ now: FIXED_NOW });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const all = await getSummary(baseUrl, '');
  const byModel = await getSummary(
    baseUrl,
    `?model=${encodeURIComponent(DASHBOARD_DEMO_MODELS[1])}`,
  );
  const byProject = await getSummary(baseUrl, '?project=synthetic-beta');
  const today = demoLocalDate(FIXED_NOW);
  const byDate = await getSummary(baseUrl, `?from=${today}&to=${today}`);

  assert.ok(all.allTime.tokenTotal > 0);
  assert.equal(all.byProject.length, 4);
  assert.equal(all.intelligence.models.length, 3);

  assert.equal(byModel.filters.model, DASHBOARD_DEMO_MODELS[1]);
  assert.ok(byModel.sessions.length > 0);
  assert.ok(byModel.sessions.every((session) => (
    session.models.length === 1 && session.models[0] === DASHBOARD_DEMO_MODELS[1]
  )));
  assert.ok(byModel.allTime.tokenTotal < all.allTime.tokenTotal);

  assert.equal(byProject.byProject.length, 1);
  assert.match(byProject.byProject[0].project, /synthetic-beta/);
  assert.ok(byProject.allTime.tokenTotal < all.allTime.tokenTotal);

  assert.deepEqual(byDate.byDay.map((day) => day.date), [today]);
  assert.ok(byDate.allTime.tokenTotal > 0);
  assert.ok(byDate.allTime.tokenTotal < all.allTime.tokenTotal);
});

test('synthetic dashboard preview rejects invalid filter queries', async (t) => {
  const server = createDashboardDemoServer({ now: FIXED_NOW });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const response = await fetch(
    `http://127.0.0.1:${address.port}/api/summary?from=2026-08-29&to=2026-08-28`,
  );

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.error, 'Invalid summary filters');
  assert.match(payload.detail, /must not be after/);
});

async function getSummary(baseUrl, query) {
  const response = await fetch(`${baseUrl}/api/summary${query}`);
  assert.equal(response.status, 200);
  return response.json();
}
