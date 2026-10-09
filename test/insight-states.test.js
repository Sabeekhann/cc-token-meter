import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  applyInsightAction,
  insightKey,
  partitionTips,
  pruneInsightStates,
} from '../src/budget/insightStates.js';
import { readConfig, writeConfig } from '../src/budget/config.js';
import { handleApiRoute } from '../src/server/routes.js';
import { buildSummary } from '../src/server/summary.js';

const NOW = '2026-10-09T12:00:00.000Z';
const tip = (id) => ({ id, sessionId: 's1', severity: 'info', message: id });

test('insight keys are short one-way hashes, so local paths never reach config', () => {
  const id = 'repeatedReads:s1:/Users/dev/secret-project/src/index.js';
  const key = insightKey(id);
  assert.match(key, /^[0-9a-f]{16}$/);
  assert.equal(insightKey(id), key);
  const states = applyInsightAction({}, { id, action: 'dismiss' }, NOW);
  assert.doesNotMatch(JSON.stringify(states), /secret-project/);
});

test('dismiss, snooze, and restore update the state map', () => {
  let states = applyInsightAction({}, { id: 'a', action: 'dismiss' }, NOW);
  states = applyInsightAction(states, { id: 'b', action: 'snooze', days: 7 }, NOW);
  assert.deepEqual(states[insightKey('a')], { status: 'dismissed', at: NOW });
  assert.deepEqual(states[insightKey('b')], { status: 'snoozed', at: NOW, until: '2026-10-16T12:00:00.000Z' });

  states = applyInsightAction(states, { id: 'a', action: 'restore' }, NOW);
  assert.equal(states[insightKey('a')], undefined);

  assert.throws(() => applyInsightAction({}, { id: 'a', action: 'hide' }, NOW), /dismiss, snooze, restore/);
  assert.throws(() => applyInsightAction({}, { id: 'a', action: 'snooze', days: 0 }, NOW), /integer from 1 to 90/);
  assert.throws(() => applyInsightAction({}, { id: '', action: 'dismiss' }, NOW), /non-empty/);
});

test('expired snoozes and malformed entries are dropped; the map stays bounded', () => {
  const snoozed = applyInsightAction({}, { id: 'b', action: 'snooze', days: 1 }, NOW);
  assert.deepEqual(pruneInsightStates(snoozed, '2026-10-10T12:00:01.000Z'), {});
  assert.deepEqual(pruneInsightStates({ nothex: { status: 'dismissed', at: NOW }, [insightKey('x')]: { status: 'weird', at: NOW } }), {});
  assert.deepEqual(pruneInsightStates(['array']), {});

  let states = {};
  for (let i = 0; i < 510; i += 1) {
    states = applyInsightAction(states, { id: `tip-${i}`, action: 'dismiss' }, Date.parse(NOW) + i * 1000);
  }
  assert.equal(Object.keys(states).length, 500);
  assert.equal(states[insightKey('tip-0')], undefined, 'oldest entries go first');
  assert.ok(states[insightKey('tip-509')]);
});

test('partitionTips hides dismissed and active snoozed tips only', () => {
  let states = applyInsightAction({}, { id: 'a', action: 'dismiss' }, NOW);
  states = applyInsightAction(states, { id: 'b', action: 'snooze', days: 1 }, NOW);
  const { visible, hidden } = partitionTips([tip('a'), tip('b'), tip('c')], states, NOW);
  assert.deepEqual(visible.map((t) => t.id), ['c']);
  assert.deepEqual(hidden.map((t) => [t.id, t.userState.status]), [['a', 'dismissed'], ['b', 'snoozed']]);

  const later = partitionTips([tip('a'), tip('b')], states, '2026-10-11T00:00:00.000Z');
  assert.deepEqual(later.visible.map((t) => t.id), ['b'], 'a snoozed tip returns when the snooze ends');
});

test('config persists insight states and sanitizes them on read', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-token-meter-insights-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'config.json');
  const states = applyInsightAction({}, { id: 'a', action: 'dismiss' }, NOW);
  writeConfig({ insightStates: states }, filePath);
  assert.deepEqual(readConfig(filePath).insightStates, states);

  fs.writeFileSync(filePath, JSON.stringify({ insightStates: { '../../x': { status: 'dismissed', at: NOW } } }));
  assert.deepEqual(readConfig(filePath).insightStates, {});
  assert.throws(() => writeConfig({ insightStates: [] }, filePath), /must be an object/);
});

test('POST /api/insights rejects invalid actions before touching config', async () => {
  const req = new (await import('node:events')).EventEmitter();
  req.method = 'POST';
  const res = {
    statusCode: null,
    body: '',
    writeHead(statusCode) { this.statusCode = statusCode; },
    end(body = '') { this.body += body; },
  };
  const handled = handleApiRoute(req, res, new URL('http://127.0.0.1/api/insights'), {});
  req.emit('data', Buffer.from(JSON.stringify({ id: 'a', action: 'delete-everything' })));
  req.emit('end');
  assert.equal(await handled, true);
  assert.equal(res.statusCode, 400);
  assert.match(res.body, /Invalid insight action/);
});

test('summary returns visible tips and hidden tips, without the raw state map', () => {
  const states = applyInsightAction({}, { id: 'longSessionNoCompact:s1', action: 'dismiss' }, new Date());
  const session = {
    sessionId: 's1',
    projectCwd: '/work/alpha',
    models: ['claude-sonnet-5'],
    messageCount: 200,
    inputTokens: 1000,
    outputTokens: 0,
    costUsd: 1,
    compactDetected: false,
    lastTimestamp: new Date().toISOString(),
    usageRecords: [],
    toolEvents: [],
  };
  const store = { getSnapshot: () => ({ sessions: [session], totalIngestedMessages: 200 }) };
  const summary = buildSummary(store, { config: { warnThresholdPct: 80, insightStates: states } });
  assert.equal(summary.tips.some((t) => t.id === 'longSessionNoCompact:s1'), false);
  assert.equal(summary.hiddenTips.some((t) => t.id === 'longSessionNoCompact:s1'), true);
  assert.equal('insightStates' in summary.config, false);
});
