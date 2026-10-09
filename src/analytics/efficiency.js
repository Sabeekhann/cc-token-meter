// Copyright 2026 FiveNodes
// SPDX-License-Identifier: Apache-2.0

import { localDateKey, tokenTotal } from '../ingest/aggregate.js';

const DAY_MS = 24 * 60 * 60 * 1000;
// Reuse at or above this share of prompt tokens earns full cache points.
const FULL_CACHE_REUSE = 0.8;
const LONG_SESSION_MESSAGES = 60;
const WARN_PENALTY = 0.15;
const INFO_PENALTY = 0.05;

const COMPONENTS = {
  cache: { label: 'Cache reuse', max: 45 },
  recommendations: { label: 'Open recommendations', max: 35 },
  compaction: { label: 'Long-session compaction', max: 20 },
};

/**
 * Usage for the last seven local days (today included) and the seven days
 * before, from per-message detail plus exact daily rollups.
 *
 * @param {Array<object>} sessions
 * @param {Date|string|number} [now]
 */
export function buildWeek(sessions, now = Date.now()) {
  const keys = (offset) => Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now);
    date.setHours(12, 0, 0, 0);
    date.setTime(date.getTime() - (offset + 6 - index) * DAY_MS);
    return localDateKey(date.toISOString());
  });
  const currentDays = keys(0);
  const previousDays = keys(7);
  const current = new Set(currentDays);
  const previous = new Set(previousDays);

  const totals = { current: emptyTotals(), previous: emptyTotals() };
  const byDay = new Map(currentDays.map((date) => [date, { date, tokenTotal: 0, costUsd: 0, messageCount: 0 }]));
  const models = new Map();
  const projects = new Map();

  const add = (unit, date, session) => {
    const bucket = current.has(date) ? 'current' : previous.has(date) ? 'previous' : null;
    if (!bucket) return;
    const messages = Number.isFinite(unit.messageCount) ? unit.messageCount : 1;
    const tokens = tokenTotal(unit);
    const cost = finite(unit.costUsd);
    addTotals(totals[bucket], unit, tokens, cost, messages);
    if (bucket !== 'current') return;
    const day = byDay.get(date);
    day.tokenTotal += tokens;
    day.costUsd += cost;
    day.messageCount += messages;
    const model = unit.model || 'unknown';
    const modelBucket = models.get(model) || { model, tokenTotal: 0, costUsd: 0 };
    modelBucket.tokenTotal += tokens;
    modelBucket.costUsd += cost;
    models.set(model, modelBucket);
    const project = session.projectCwd || session.projectDirNameFallback || 'unknown';
    const projectBucket = projects.get(project) || { project, tokenTotal: 0, costUsd: 0, sessionIds: new Set() };
    projectBucket.tokenTotal += tokens;
    projectBucket.costUsd += cost;
    projectBucket.sessionIds.add(session.sessionId);
    projects.set(project, projectBucket);
  };

  for (const session of Array.isArray(sessions) ? sessions : []) {
    for (const rollup of Array.isArray(session.dailyRollups) ? session.dailyRollups : []) {
      if (rollup && rollup.date) add(rollup, rollup.date, session);
    }
    for (const record of Array.isArray(session.usageRecords) ? session.usageRecords : []) {
      const date = record && record.timestamp ? localDateKey(record.timestamp) : null;
      if (date) add(record, date, session);
    }
  }

  return {
    start: currentDays[0],
    end: currentDays[6],
    current: totals.current,
    previous: totals.previous,
    byDay: Array.from(byDay.values()),
    models: Array.from(models.values()).sort((a, b) => b.costUsd - a.costUsd),
    projects: Array.from(projects.values())
      .map((bucket) => ({ project: bucket.project, tokenTotal: bucket.tokenTotal, costUsd: bucket.costUsd, sessionCount: bucket.sessionIds.size }))
      .sort((a, b) => b.costUsd - a.costUsd)
      .slice(0, 10),
    activeDates: currentDays,
  };
}

/**
 * A 0–100 weekly efficiency score built only from what the meter measures.
 * Components that do not apply this week (no prompt tokens, no long
 * sessions) are left out and the rest re-weighted, so the score stays out
 * of 100. This is a local heuristic for spotting habits, not a benchmark.
 *
 * @param {ReturnType<typeof buildWeek>} week
 * @param {Array<object>} sessions
 * @param {Array<{sessionId: string, severity: string}>} tips all tips, dismissed ones included
 */
export function scoreEfficiency(week, sessions, tips) {
  const weekDates = new Set(week.activeDates);
  const weekSessions = (Array.isArray(sessions) ? sessions : []).filter((session) => {
    const date = session.lastTimestamp ? localDateKey(session.lastTimestamp) : null;
    return date && weekDates.has(date);
  });
  if (week.current.messageCount === 0) {
    return { score: null, components: [], suggestion: null };
  }

  const components = [];
  const promptTokens = week.current.inputTokens + week.current.cacheCreationInputTokens + week.current.cacheReadInputTokens;
  if (promptTokens > 0) {
    const reuse = week.current.cacheReadInputTokens / promptTokens;
    components.push(component('cache', Math.min(1, reuse / FULL_CACHE_REUSE), `${Math.round(reuse * 100)}% of prompt tokens came from cache`));
  }

  const weekSessionIds = new Set(weekSessions.map((session) => session.sessionId));
  const weekTips = (Array.isArray(tips) ? tips : []).filter((tip) => weekSessionIds.has(tip.sessionId));
  const warnCount = weekTips.filter((tip) => tip.severity === 'warn').length;
  const infoCount = weekTips.length - warnCount;
  components.push(component(
    'recommendations',
    Math.max(0, 1 - warnCount * WARN_PENALTY - infoCount * INFO_PENALTY),
    weekTips.length === 0 ? 'No recommendations this week' : `${warnCount} needing attention, ${infoCount} optimizations`,
  ));

  const longSessions = weekSessions.filter((session) => (session.messageCount || 0) >= LONG_SESSION_MESSAGES && typeof session.compactDetected === 'boolean');
  if (longSessions.length > 0) {
    const compacted = longSessions.filter((session) => session.compactDetected).length;
    components.push(component('compaction', compacted / longSessions.length, `${compacted} of ${longSessions.length} long sessions used /compact`));
  }

  const earned = components.reduce((sum, item) => sum + item.points, 0);
  const possible = components.reduce((sum, item) => sum + item.max, 0);
  const weakest = components
    .map((item) => ({ ...item, lost: item.max - item.points }))
    .sort((a, b) => b.lost - a.lost)[0];

  return {
    score: Math.round((earned / possible) * 100),
    components,
    suggestion: weakest && weakest.lost > 0 ? SUGGESTIONS[weakest.key] : null,
  };
}

const SUGGESTIONS = {
  cache: 'Keep sessions focused and avoid restarting them for the same task, so earlier context is read from cache instead of rebuilt.',
  recommendations: 'Work through the open recommendations in Insights; each one names the session and a concrete change.',
  compaction: 'Run /compact in long sessions at a natural break so context stays lean.',
};

function component(key, ratio, detail) {
  const { label, max } = COMPONENTS[key];
  return { key, label, max, points: Math.round(max * Math.max(0, Math.min(1, ratio))), detail };
}

function emptyTotals() {
  return {
    tokenTotal: 0,
    costUsd: 0,
    messageCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  };
}

function addTotals(target, unit, tokens, cost, messages) {
  target.tokenTotal += tokens;
  target.costUsd += cost;
  target.messageCount += messages;
  target.inputTokens += finite(unit.inputTokens);
  target.outputTokens += finite(unit.outputTokens);
  target.cacheCreationInputTokens += finite(unit.cacheCreationInputTokens);
  target.cacheReadInputTokens += finite(unit.cacheReadInputTokens);
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
