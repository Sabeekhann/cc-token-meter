// Copyright 2026 FiveNodes
// SPDX-License-Identifier: Apache-2.0

import { aggregateByDay, localDateKey, tokenTotal } from '../ingest/aggregate.js';

/**
 * Claude subscription plans. Monthly prices are list prices used only to
 * express local API-equivalent value as a multiple of the plan; users can
 * override them with `planMonthlyUsd`. Anthropic does not publish token
 * limits for subscription usage windows, so none are encoded here: window
 * progress is measured against a user-set limit or the user's own record.
 */
export const PLAN_PRESETS = {
  api: { label: 'API (pay as you go)', monthlyUsd: null },
  pro: { label: 'Pro', monthlyUsd: 20 },
  max5x: { label: 'Max 5×', monthlyUsd: 100 },
  max20x: { label: 'Max 20×', monthlyUsd: 200 },
};

export const BLOCK_HOURS = 5;
const BLOCK_MS = BLOCK_HOURS * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const RECENT_BLOCK_COUNT = 8;
const HISTORY_DAYS = 8;

/**
 * Group usage records into estimated subscription usage windows. A window
 * opens at the hour containing the first message after the previous window
 * closed and lasts BLOCK_HOURS. This mirrors how Claude reports reset times
 * on the hour, but it is a local reconstruction, not Anthropic's accounting.
 *
 * @param {Array<{timestamp: string, costUsd?: number}>} records
 * @param {{now?: Date|string|number}} [options]
 * @returns {Array<{start: string, end: string, tokenTotal: number, costUsd: number, messageCount: number, lastTimestamp: string, active: boolean}>}
 */
export function buildUsageBlocks(records, { now = Date.now() } = {}) {
  const nowMs = new Date(now).getTime();
  const timed = [];
  for (const record of Array.isArray(records) ? records : []) {
    const ms = record && record.timestamp ? Date.parse(record.timestamp) : NaN;
    if (Number.isFinite(ms)) timed.push({ ms, record });
  }
  timed.sort((a, b) => a.ms - b.ms);

  const blocks = [];
  let current = null;
  for (const { ms, record } of timed) {
    if (!current || ms >= current.endMs) {
      // Floor to the local hour so half-hour time zones get on-the-hour resets.
      const startMs = new Date(ms).setMinutes(0, 0, 0);
      current = { startMs, endMs: startMs + BLOCK_MS, tokenTotal: 0, costUsd: 0, messageCount: 0, lastMs: ms };
      blocks.push(current);
    }
    current.tokenTotal += tokenTotal(record);
    current.costUsd += Number.isFinite(record.costUsd) ? record.costUsd : 0;
    current.messageCount += 1;
    current.lastMs = ms;
  }

  return blocks.map((block) => ({
    start: new Date(block.startMs).toISOString(),
    end: new Date(block.endMs).toISOString(),
    tokenTotal: block.tokenTotal,
    costUsd: block.costUsd,
    messageCount: block.messageCount,
    lastTimestamp: new Date(block.lastMs).toISOString(),
    active: Number.isFinite(nowMs) && nowMs >= block.startMs && nowMs < block.endMs,
  }));
}

/**
 * Plan-aware usage intelligence: the current estimated 5-hour window, the
 * user's record window, a rolling 7-day total, and month-to-date
 * API-equivalent value compared with the plan price. Uses all sessions, not
 * a filtered scope, because subscription windows are account-wide.
 *
 * @param {Array<object>} sessions session aggregates with usageRecords/dailyRollups
 * @param {object} config sanitized config (plan, planMonthlyUsd, blockTokenLimit, weeklyTokenLimit)
 * @param {{now?: Date|string|number, byDay?: Array<object>}} [options]
 */
export function buildPlanIntelligence(sessions, config = {}, { now = Date.now(), byDay } = {}) {
  const nowDate = new Date(now);
  const nowMs = nowDate.getTime();
  const plan = Object.hasOwn(PLAN_PRESETS, config.plan) ? config.plan : 'api';
  const preset = PLAN_PRESETS[plan];
  const planMonthlyUsd = positiveOrNull(config.planMonthlyUsd) ?? preset.monthlyUsd;

  const cutoffMs = nowMs - HISTORY_DAYS * 24 * HOUR_MS;
  const records = [];
  for (const session of Array.isArray(sessions) ? sessions : []) {
    for (const record of Array.isArray(session.usageRecords) ? session.usageRecords : []) {
      const ms = record && record.timestamp ? Date.parse(record.timestamp) : NaN;
      if (Number.isFinite(ms) && ms >= cutoffMs && ms <= nowMs) records.push(record);
    }
  }

  const blocks = buildUsageBlocks(records, { now: nowMs });
  const active = blocks.find((block) => block.active) || null;
  const completed = blocks.filter((block) => !block.active);
  const recordBlockTokens = completed.length
    ? Math.max(...completed.map((block) => block.tokenTotal))
    : null;
  const blockTokenLimit = positiveOrNull(config.blockTokenLimit);

  let currentBlock = null;
  if (active) {
    const startMs = Date.parse(active.start);
    const endMs = Date.parse(active.end);
    const elapsedMinutes = Math.max(1, (nowMs - startMs) / 60_000);
    const remainingMinutes = Math.max(0, (endMs - nowMs) / 60_000);
    const tokensPerMinute = active.tokenTotal / elapsedMinutes;
    const reference = blockTokenLimit ?? recordBlockTokens;
    currentBlock = {
      ...active,
      remainingMinutes: Math.round(remainingMinutes),
      tokensPerMinute,
      projectedTokens: Math.round(active.tokenTotal + tokensPerMinute * remainingMinutes),
      reference,
      referenceKind: blockTokenLimit ? 'limit' : recordBlockTokens ? 'record' : null,
      ratio: reference ? active.tokenTotal / reference : null,
      projectedRatio: reference ? (active.tokenTotal + tokensPerMinute * remainingMinutes) / reference : null,
    };
  }

  const days = Array.isArray(byDay) ? byDay : aggregateByDay(Array.isArray(sessions) ? sessions : []);
  const todayKey = localDateKey(nowDate.toISOString());
  const weekStart = new Date(nowDate);
  weekStart.setHours(12, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - 6);
  const weekStartKey = localDateKey(weekStart.toISOString());
  const monthPrefix = todayKey ? todayKey.slice(0, 7) : '';
  const weekly = { tokenTotal: 0, costUsd: 0 };
  let monthToDateUsd = 0;
  for (const day of days) {
    if (!day || !day.date || day.date > todayKey) continue;
    if (day.date >= weekStartKey) {
      weekly.tokenTotal += day.tokenTotal || 0;
      weekly.costUsd += day.costUsd || 0;
    }
    if (day.date.startsWith(monthPrefix)) monthToDateUsd += day.costUsd || 0;
  }
  const weeklyTokenLimit = positiveOrNull(config.weeklyTokenLimit);

  return {
    plan,
    planLabel: preset.label,
    planMonthlyUsd,
    blockHours: BLOCK_HOURS,
    currentBlock,
    recordBlockTokens,
    blockTokenLimit,
    recentBlocks: blocks.slice(-RECENT_BLOCK_COUNT).map(({ start, end, tokenTotal: tokens, costUsd, messageCount, active: isActive }) => ({
      start, end, tokenTotal: tokens, costUsd, messageCount, active: isActive,
    })),
    weekly: {
      ...weekly,
      limit: weeklyTokenLimit,
      ratio: weeklyTokenLimit ? weekly.tokenTotal / weeklyTokenLimit : null,
    },
    apiValue: {
      monthToDateUsd,
      planMonthlyUsd,
      multipleOfPlan: planMonthlyUsd ? monthToDateUsd / planMonthlyUsd : null,
    },
  };
}

function positiveOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}
