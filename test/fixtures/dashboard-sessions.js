// Copyright 2026 FiveNodes
// SPDX-License-Identifier: Apache-2.0

import { computeCost } from '../../src/pricing/cost.js';

export const DASHBOARD_DEMO_MODELS = [
  'claude-sonnet-5',
  'claude-opus-4-5',
  'claude-haiku-4-5',
];

const SESSION_SPECS = [
  {
    sessionId: 'demo-session-alpha',
    projectCwd: '/Users/example/projects/synthetic-alpha',
    gitBranch: 'feature/synthetic-alpha',
    model: DASHBOARD_DEMO_MODELS[0],
    dayOffsets: Array.from({ length: 20 }, (_, index) => 19 - index),
    scale: 5,
    repeatedRead: true,
  },
  {
    sessionId: 'demo-session-beta',
    projectCwd: '/Users/example/projects/synthetic-alpha',
    gitBranch: 'fix/synthetic-cache',
    model: DASHBOARD_DEMO_MODELS[1],
    dayOffsets: [92, 70, 45, 30, 14, 6, 2, 0],
    scale: 4,
  },
  {
    sessionId: 'demo-session-gamma',
    projectCwd: '/Users/example/projects/synthetic-beta',
    gitBranch: 'feature/synthetic-report',
    model: DASHBOARD_DEMO_MODELS[2],
    dayOffsets: [80, 40, 21, 10, 6, 4, 2, 1, 0],
    scale: 3,
  },
  {
    sessionId: 'demo-session-delta',
    projectCwd: '/Users/example/projects/synthetic-gamma',
    gitBranch: 'main',
    model: DASHBOARD_DEMO_MODELS[0],
    dayOffsets: [120, 90, 60, 30],
    scale: 2,
  },
  {
    sessionId: 'demo-session-epsilon',
    projectCwd: '/Users/example/projects/synthetic-delta',
    gitBranch: 'feature/synthetic-budget',
    model: DASHBOARD_DEMO_MODELS[1],
    dayOffsets: [12, 7, 3, 1, 0],
    scale: 3,
  },
];

export function createDashboardDemoStore({ now = new Date() } = {}) {
  const sessions = SESSION_SPECS.map((spec) => createSession(spec, now));
  const totalIngestedMessages = sessions.reduce(
    (sum, session) => sum + session.messageCount,
    0,
  );

  return {
    getSnapshot() {
      return { sessions, totalIngestedMessages };
    },
  };
}

export function demoLocalDate(now = new Date(), dayOffset = 0) {
  const date = new Date(now);
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - dayOffset);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function createSession(spec, now) {
  const usageRecords = spec.dayOffsets.map((dayOffset, index) => {
    const timestamp = demoTimestamp(now, dayOffset, index);
    const multiplier = spec.scale * 10;
    const record = {
      sessionId: spec.sessionId,
      projectCwd: spec.projectCwd,
      timestamp,
      model: spec.model,
      inputTokens: (900 + index * 35) * multiplier,
      outputTokens: (280 + index * 18) * multiplier,
      cacheCreationInputTokens: (300 + index * 55) * multiplier,
      cacheReadInputTokens: Math.max(450, 3_200 - index * 115) * multiplier,
      cacheWrite5m: (300 + index * 55) * multiplier,
      cacheWrite1h: 0,
      gitBranch: spec.gitBranch,
      version: '2.1.170-demo',
    };
    const cost = computeCost(record);
    return {
      ...record,
      costUsd: cost.totalCost,
      estimatedCostUsed: cost.estimated,
    };
  });

  const totals = usageRecords.reduce((acc, record) => {
    acc.inputTokens += record.inputTokens;
    acc.outputTokens += record.outputTokens;
    acc.cacheCreationInputTokens += record.cacheCreationInputTokens;
    acc.cacheReadInputTokens += record.cacheReadInputTokens;
    acc.cacheWrite5m += record.cacheWrite5m;
    acc.cacheWrite1h += record.cacheWrite1h;
    acc.costUsd += record.costUsd;
    acc.estimatedCostUsed ||= record.estimatedCostUsed;
    return acc;
  }, {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    costUsd: 0,
    estimatedCostUsed: false,
  });

  return {
    sessionId: spec.sessionId,
    projectCwd: spec.projectCwd,
    projectDirNameFallback: null,
    models: [spec.model],
    firstTimestamp: usageRecords[0].timestamp,
    lastTimestamp: usageRecords.at(-1).timestamp,
    messageCount: usageRecords.length,
    ...totals,
    gitBranch: spec.gitBranch,
    version: '2.1.170-demo',
    compactDetected: false,
    dailyRollups: [],
    usageRecords,
    toolEvents: spec.repeatedRead ? repeatedReadEvents(spec, now) : [],
  };
}

function demoTimestamp(now, dayOffset, index) {
  if (dayOffset === 0) {
    const recent = new Date(now.getTime() - ((index % 5) + 1) * 60_000);
    if (demoLocalDate(recent) === demoLocalDate(now)) return recent.toISOString();
    return new Date(now).toISOString();
  }

  const date = new Date(now);
  date.setHours(12, index % 60, 0, 0);
  date.setDate(date.getDate() - dayOffset);
  return date.toISOString();
}

function repeatedReadEvents(spec, now) {
  const filePath = `${spec.projectCwd}/src/dashboard.js`;
  return [3, 2, 1].map((minutesAgo) => ({
    kind: 'tool_use',
    name: 'Read',
    filePath,
    timestamp: new Date(now.getTime() - minutesAgo * 60_000).toISOString(),
  }));
}
