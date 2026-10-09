import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAttribution, subagentsByParent } from '../src/analytics/attribution.js';
import { buildSummary } from '../src/server/summary.js';

const parent = {
  sessionId: 'p1',
  projectCwd: '/work/alpha',
  models: ['claude-opus-5'],
  messageCount: 4,
  inputTokens: 600,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
  costUsd: 6,
  lastTimestamp: '2026-10-01T10:05:00.000Z',
  usageRecords: [],
  toolEvents: [],
  subagentTypes: { a1: 'Explore', a2: 'Explore', a3: 'general-purpose' },
  toolStatsByDay: {
    '2026-10-01': {
      Read: { calls: 3, resultBytes: 4000 },
      mcp__github__get_file: { calls: 2, resultBytes: 8000 },
      mcp__github__search: { calls: 1, resultBytes: 400 },
    },
  },
};
const agent = (agentId, tokens, cost, extra = {}) => ({
  sessionId: `p1:agent-${agentId}`,
  parentSessionId: 'p1',
  agentId,
  projectCwd: '/work/alpha',
  models: ['claude-haiku-4-5'],
  messageCount: 2,
  inputTokens: tokens,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
  costUsd: cost,
  lastTimestamp: '2026-10-01T10:03:00.000Z',
  usageRecords: [],
  toolEvents: [],
  toolStatsByDay: { '2026-10-01': { Grep: { calls: 5, resultBytes: 1000 } } },
  ...extra,
});
const sessions = [parent, agent('a1', 200, 1), agent('a2', 100, 0.5), agent('a3', 100, 0.5), agent('zz', 0, 0)];

test('buildAttribution totals subagents by type and their share of scope tokens', () => {
  const { subagents } = buildAttribution(sessions);
  assert.equal(subagents.runs, 4);
  assert.equal(subagents.tokenTotal, 400);
  assert.equal(subagents.share, 0.4);
  assert.deepEqual(subagents.byType.map((t) => [t.agentType, t.runs, t.tokenTotal]), [
    ['Explore', 2, 300],
    ['general-purpose', 1, 100],
    [null, 1, 0],
  ]);
});

test('buildAttribution ranks tools by result size and groups MCP servers', () => {
  const attribution = buildAttribution(sessions);
  assert.deepEqual(attribution.tools.map((t) => [t.name, t.calls, t.resultBytes]), [
    ['mcp__github__get_file', 2, 8000],
    ['Grep', 20, 4000], // ties on bytes break by call count
    ['Read', 3, 4000],
    ['mcp__github__search', 1, 400],
  ]);
  assert.equal(attribution.tools[0].server, 'github');
  assert.equal(attribution.tools[0].estimatedTokens, 2000);
  assert.equal(attribution.tools[1].server, null);
  assert.deepEqual(attribution.mcpServers, [{ server: 'github', tools: 2, calls: 3, resultBytes: 8400, estimatedTokens: 2100 }]);
  assert.deepEqual(attribution.toolTotals, { distinctTools: 4, calls: 26, resultBytes: 16400 });
  assert.equal(buildAttribution(sessions, { topTools: 1 }).tools.length, 1);
});

test('buildAttribution is empty for scopes without subagents or tools', () => {
  const attribution = buildAttribution([{ ...parent, subagentTypes: {}, toolStatsByDay: {} }]);
  assert.equal(attribution.subagents.runs, 0);
  assert.equal(attribution.subagents.share, 0);
  assert.deepEqual(attribution.tools, []);
  assert.deepEqual(buildAttribution([]).subagents.byType, []);
});

test('subagentsByParent nests subagents under their parent, largest first', () => {
  const grouped = subagentsByParent(sessions);
  assert.deepEqual(grouped.get('p1').map((a) => [a.agentId, a.agentType]), [
    ['a1', 'Explore'], ['a2', 'Explore'], ['a3', 'general-purpose'], ['zz', null],
  ]);
});

test('summary counts subagents in totals but lists them under their parent session', () => {
  const store = { getSnapshot: () => ({ sessions, totalIngestedMessages: 12 }) };
  const summary = buildSummary(store, { config: { warnThresholdPct: 80, sessionCostCapUsd: 7 } });

  assert.equal(summary.allTime.tokenTotal, 1000, 'subagent tokens are part of all-time usage');
  assert.equal(summary.byProject[0].tokenTotal, 1000);
  assert.deepEqual(summary.byProject[0].sessions.map((s) => s.sessionId), ['p1']);
  assert.deepEqual(summary.sessions.map((s) => s.sessionId), ['p1']);
  assert.equal(summary.sessions[0].subagents.length, 4);
  assert.equal(summary.sessions[0].subagentTokenTotal, 400);
  assert.equal(summary.sessions[0].subagentCostUsd, 2);
  assert.equal(summary.attribution.subagents.runs, 4);
  // $6 own + $2 subagents crosses the $7 session cap.
  assert.ok(summary.alerts.some((alert) => alert.scope === 'session' && alert.level === 'exceeded'));
});
