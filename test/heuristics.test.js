import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repeatedReads } from '../src/heuristics/repeatedReads.js';
import { cacheRatio } from '../src/heuristics/cacheRatio.js';
import { longSessionNoCompact, detectCompactEvent } from '../src/heuristics/longSessionNoCompact.js';
import { outlierSessionTotal } from '../src/heuristics/outlierSessionTotal.js';
import { largeToolResultSpike } from '../src/heuristics/largeToolResultSpike.js';
import { clearHeuristicsCache, runHeuristics } from '../src/heuristics/index.js';

function toolUse(name, filePath, timestamp, toolUseId) {
  return { kind: 'tool_use', name, filePath, timestamp, toolUseId: toolUseId || `tu-${timestamp}` };
}

function toolResult(toolUseId, contentByteLength, timestamp) {
  return { kind: 'tool_result', toolUseId, contentByteLength, timestamp };
}

// --- repeatedReads ---

test('repeatedReads: true positive — 3+ reads of same file, no edit in between', () => {
  const session = {
    sessionId: 's1',
    models: ['claude-sonnet-5-20260101'],
    lastTimestamp: '2026-01-01T00:00:03.000Z',
    usageRecords: [
      { inputTokens: 1000 },
      { inputTokens: 2000 },
      { inputTokens: 3000 },
    ],
  };
  const events = [
    toolUse('Read', '/a.js', '2026-01-01T00:00:01.000Z'),
    toolUse('Read', '/a.js', '2026-01-01T00:00:02.000Z'),
    toolUse('Read', '/a.js', '2026-01-01T00:00:03.000Z'),
  ];
  const tips = repeatedReads(session, events);
  assert.equal(tips.length, 1);
  assert.match(tips[0].message, /3 times/);
  assert.equal(typeof tips[0].estimatedSavingsTokens, 'number');
  assert.ok(tips[0].estimatedSavingsTokens > 0);
  assert.equal(typeof tips[0].estimatedSavingsUsd, 'number');
  assert.ok(tips[0].estimatedSavingsUsd > 0);
});

test('repeatedReads: true negative — an Edit between reads resets the counter (no tip)', () => {
  const session = { sessionId: 's2' };
  const events = [
    toolUse('Read', '/a.js', '2026-01-01T00:00:01.000Z'),
    toolUse('Read', '/a.js', '2026-01-01T00:00:02.000Z'),
    toolUse('Edit', '/a.js', '2026-01-01T00:00:02.500Z'),
    toolUse('Read', '/a.js', '2026-01-01T00:00:03.000Z'),
  ];
  const tips = repeatedReads(session, events);
  assert.equal(tips.length, 0);
});

// --- cacheRatio ---

function makeAssistantMsg(ts, cacheCreation, cacheRead) {
  return {
    timestamp: ts,
    cacheCreationInputTokens: cacheCreation,
    cacheReadInputTokens: cacheRead,
  };
}

test('cacheRatio: true positive — ratio increases 2x+ from first quarter to last quarter', () => {
  const records = [];
  // First 5 (of 20): low ratio (write:read = 1:10 = 0.1)
  for (let i = 0; i < 5; i++) {
    records.push(makeAssistantMsg(`2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z`, 10, 100));
  }
  // Middle 10: irrelevant
  for (let i = 5; i < 15; i++) {
    records.push(makeAssistantMsg(`2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z`, 10, 100));
  }
  // Last 5: high ratio (write:read = 100:10 = 10, i.e. 100x the first quarter)
  for (let i = 15; i < 20; i++) {
    records.push(makeAssistantMsg(`2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z`, 100, 10));
  }

  const session = {
    sessionId: 's3',
    usageRecords: records,
    models: ['claude-sonnet-5-20260101'],
    lastTimestamp: '2026-01-01T00:00:19.000Z',
  };
  const tips = cacheRatio(session);
  assert.equal(tips.length, 1);
  assert.match(tips[0].message, /cache writes are outpacing cache reads/);
  assert.equal(typeof tips[0].estimatedSavingsTokens, 'number');
  assert.ok(tips[0].estimatedSavingsTokens > 0);
  assert.equal(typeof tips[0].estimatedSavingsUsd, 'number');
  assert.ok(tips[0].estimatedSavingsUsd > 0);
});

test('cacheRatio: true negative — stable ratio throughout, and under 20 messages', () => {
  const stableRecords = [];
  for (let i = 0; i < 20; i++) {
    stableRecords.push(makeAssistantMsg(`2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z`, 10, 100));
  }
  const stableSession = { sessionId: 's4', usageRecords: stableRecords };
  assert.equal(cacheRatio(stableSession).length, 0);

  const tooFewRecords = stableRecords.slice(0, 10);
  const tooFewSession = { sessionId: 's5', usageRecords: tooFewRecords };
  assert.equal(cacheRatio(tooFewSession).length, 0);
});

// --- longSessionNoCompact ---

test('longSessionNoCompact: true positive — 60+ messages, no compact detected', () => {
  const session = { sessionId: 's6', messageCount: 65, compactDetected: false };
  const tips = longSessionNoCompact(session, [], [], []);
  assert.equal(tips.length, 1);
  assert.match(tips[0].message, /65 turns/);
  assert.equal(tips[0].estimatedSavingsTokens, null);
  assert.equal(tips[0].estimatedSavingsUsd, null);
});

test('longSessionNoCompact: unavailable compact evidence does not produce a warning', () => {
  const session = { sessionId: 'legacy-cache', messageCount: 65 };
  assert.equal(longSessionNoCompact(session, [], [], []).length, 0);
  assert.equal(detectCompactEvent([]), null);
});

test('runHeuristics invalidates cached warnings when compact evidence changes', () => {
  clearHeuristicsCache();
  const session = { sessionId: 'cache-state', messageCount: 65, compactDetected: false };
  assert.ok(runHeuristics(session, [], [session]).some((tip) => tip.id.startsWith('longSessionNoCompact:')));

  session.compactDetected = true;
  assert.equal(
    runHeuristics(session, [], [session]).some((tip) => tip.id.startsWith('longSessionNoCompact:')),
    false,
  );
  clearHeuristicsCache();
});

test('longSessionNoCompact: true negative — 60+ messages but a /compact line is present', () => {
  const session = { sessionId: 's7', messageCount: 70 };
  const rawLines = [
    { type: 'user', message: { content: '/compact' } },
  ];
  const tips = longSessionNoCompact(session, [], [], rawLines);
  assert.equal(tips.length, 0);
});

test('longSessionNoCompact: true negative — under 60 messages', () => {
  const session = { sessionId: 's8', messageCount: 10 };
  const tips = longSessionNoCompact(session, [], [], []);
  assert.equal(tips.length, 0);
});

test('detectCompactEvent: detects system-type "compact" mention as secondary signal', () => {
  const rawLines = [{ type: 'system', content: 'Context was compacted automatically' }];
  assert.equal(detectCompactEvent(rawLines), true);
});

test('detectCompactEvent: detects Claude Code command-tag form', () => {
  const rawLines = [{
    type: 'user',
    message: {
      content: '<command-message>compact</command-message>\n<command-name>/compact</command-name>',
    },
  }];
  assert.equal(detectCompactEvent(rawLines), true);
});

test('detectCompactEvent: non-compact raw lines establish negative evidence', () => {
  const rawLines = [{ type: 'user', message: { content: 'Continue with the task' } }];
  assert.equal(detectCompactEvent(rawLines), false);
});

// --- outlierSessionTotal ---

function makeHistSession(id, total) {
  // Split evenly across the 4 token fields for simplicity.
  const quarter = total / 4;
  return {
    sessionId: id,
    inputTokens: quarter,
    outputTokens: quarter,
    cacheCreationInputTokens: quarter,
    cacheReadInputTokens: quarter,
    costUsd: total * 0.00001,
  };
}

test('outlierSessionTotal: true positive — session exceeds p90 of 5+ historical sessions', () => {
  const history = [
    makeHistSession('h1', 1000),
    makeHistSession('h2', 2000),
    makeHistSession('h3', 3000),
    makeHistSession('h4', 4000),
    makeHistSession('h5', 5000),
  ];
  const current = makeHistSession('current', 100000); // way above p90
  const allSessions = [...history, current];

  const tips = outlierSessionTotal(current, [], allSessions);
  assert.equal(tips.length, 1);
  assert.match(tips[0].message, /more than 90% of your past sessions/);
  assert.equal(tips[0].estimatedSavingsTokens, null);
  assert.equal(tips[0].estimatedSavingsUsd, null);
});

test('outlierSessionTotal: true negative — fewer than 5 historical sessions (skip)', () => {
  const history = [makeHistSession('h1', 1000), makeHistSession('h2', 2000)];
  const current = makeHistSession('current', 100000);
  const allSessions = [...history, current];

  const tips = outlierSessionTotal(current, [], allSessions);
  assert.equal(tips.length, 0);
});

test('outlierSessionTotal: true negative — session within normal range', () => {
  const history = [
    makeHistSession('h1', 1000),
    makeHistSession('h2', 2000),
    makeHistSession('h3', 3000),
    makeHistSession('h4', 4000),
    makeHistSession('h5', 5000),
  ];
  const current = makeHistSession('current', 1500);
  const allSessions = [...history, current];

  const tips = outlierSessionTotal(current, [], allSessions);
  assert.equal(tips.length, 0);
});

// --- largeToolResultSpike ---

test('largeToolResultSpike: true positive — large tool_result precedes a top-10% output-token message', () => {
  const records = [];
  for (let i = 0; i < 9; i++) {
    records.push({
      timestamp: `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z`,
      outputTokens: 100, // normal
    });
  }
  // 10th message: unusually large output, right after a big tool_result.
  records.push({
    timestamp: '2026-01-01T00:00:09.500Z',
    outputTokens: 5000,
  });

  const events = [
    toolUse('Read', '/big-file.txt', '2026-01-01T00:00:09.000Z', 'tu-big'),
    toolResult('tu-big', 60000, '2026-01-01T00:00:09.200Z'),
  ];

  const session = {
    sessionId: 's9',
    usageRecords: records,
    models: ['claude-sonnet-5-20260101'],
    lastTimestamp: '2026-01-01T00:00:09.500Z',
  };
  const tips = largeToolResultSpike(session, events);
  assert.equal(tips.length, 1);
  assert.match(tips[0].message, /58KB|59KB|60KB/); // ~60000 bytes / 1024 ≈ 58.6KB
  assert.equal(typeof tips[0].estimatedSavingsTokens, 'number');
  assert.ok(tips[0].estimatedSavingsTokens > 0);
  assert.equal(typeof tips[0].estimatedSavingsUsd, 'number');
  assert.ok(tips[0].estimatedSavingsUsd > 0);
});

test('largeToolResultSpike: true negative — under 10 assistant messages (skip)', () => {
  const records = [];
  for (let i = 0; i < 5; i++) {
    records.push({ timestamp: `2026-01-01T00:00:0${i}.000Z`, outputTokens: 100 });
  }
  const events = [
    toolUse('Read', '/big-file.txt', '2026-01-01T00:00:04.000Z', 'tu-big'),
    toolResult('tu-big', 60000, '2026-01-01T00:00:04.200Z'),
  ];
  const session = { sessionId: 's10', usageRecords: records };
  const tips = largeToolResultSpike(session, events);
  assert.equal(tips.length, 0);
});

test('largeToolResultSpike: true negative — large tool_result but next message output is not top-10%', () => {
  const records = [];
  for (let i = 0; i < 10; i++) {
    records.push({
      timestamp: `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z`,
      outputTokens: 100, // all uniform, nothing unusual
    });
  }
  const events = [
    toolUse('Read', '/big-file.txt', '2026-01-01T00:00:04.000Z', 'tu-big'),
    toolResult('tu-big', 60000, '2026-01-01T00:00:04.200Z'),
  ];
  const session = { sessionId: 's11', usageRecords: records };
  const tips = largeToolResultSpike(session, events);
  assert.equal(tips.length, 0);
});
