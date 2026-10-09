// Copyright 2026 FiveNodes
// SPDX-License-Identifier: Apache-2.0

import { computeCost } from '../pricing/cost.js';
import { localDateKey, tokenTotal } from '../ingest/aggregate.js';

// Claude Code's standard context window. Sessions that run with an extended
// window carry a `[1m]` model suffix, and any observed prompt above the
// standard size also proves the larger window is in use.
export const DEFAULT_CONTEXT_WINDOW = 200_000;
export const EXTENDED_CONTEXT_WINDOW = 1_000_000;

const ANSI = {
  reset: '\u001b[0m',
  dim: '\u001b[2m',
  amber: '\u001b[33m',
  red: '\u001b[31m',
};

/**
 * Total normalized usage records (parser output) for the statusline.
 * Records without a usable timestamp still count toward the session total
 * but never toward "today".
 *
 * @param {Array<object>} records
 * @param {{todayKey?: string|null, pricingTable?: Array<object>}} [options]
 */
export function summarizeUsageRecords(records, { todayKey = null, pricingTable } = {}) {
  const totals = {
    messageCount: 0,
    tokenTotal: 0,
    costUsd: 0,
    estimated: false,
    inputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    latestPromptTokens: 0,
    maxPromptTokens: 0,
    latestModel: null,
    today: { tokenTotal: 0, costUsd: 0, estimated: false },
  };

  for (const record of Array.isArray(records) ? records : []) {
    if (!record || typeof record !== 'object') continue;
    const cost = pricingTable ? computeCost(record, pricingTable) : computeCost(record);
    const tokens = tokenTotal(record);
    const prompt = promptTokens(record);

    totals.messageCount += 1;
    totals.tokenTotal += tokens;
    totals.costUsd += cost.totalCost;
    totals.estimated ||= cost.estimated;
    totals.inputTokens += record.inputTokens || 0;
    totals.cacheCreationInputTokens += record.cacheCreationInputTokens || 0;
    totals.cacheReadInputTokens += record.cacheReadInputTokens || 0;
    totals.latestPromptTokens = prompt;
    totals.maxPromptTokens = Math.max(totals.maxPromptTokens, prompt);
    if (record.model) totals.latestModel = record.model;

    if (todayKey && record.timestamp && localDateKey(record.timestamp) === todayKey) {
      totals.today.tokenTotal += tokens;
      totals.today.costUsd += cost.totalCost;
      totals.today.estimated ||= cost.estimated;
    }
  }

  return totals;
}

function promptTokens(record) {
  return (record.inputTokens || 0) + (record.cacheCreationInputTokens || 0) + (record.cacheReadInputTokens || 0);
}

/**
 * @param {string|null|undefined} model
 * @param {number} observedMaxPrompt
 */
export function contextWindowFor(model, observedMaxPrompt = 0) {
  if (/\[1m\]/i.test(String(model || '')) || observedMaxPrompt > DEFAULT_CONTEXT_WINDOW) {
    return EXTENDED_CONTEXT_WINDOW;
  }
  return DEFAULT_CONTEXT_WINDOW;
}

/**
 * Build the one-line statusline text.
 *
 * @param {{
 *   session: ReturnType<typeof summarizeUsageRecords>|null,
 *   today: {tokenTotal: number, costUsd: number, estimated: boolean, partial?: boolean}|null,
 *   config?: {dailyCostCapUsd?: number|null, dailyTokenCap?: number|null, sessionCostCapUsd?: number|null, warnThresholdPct?: number|null},
 *   model?: string|null,
 *   planWindow?: {tokenTotal: number, remainingMinutes: number}|{idle: true}|null,
 *   color?: boolean,
 * }} input
 * @returns {string}
 */
export function formatStatusline({ session, today, config = {}, model = null, planWindow = null, color = false }) {
  const paint = (text, tone) => (color && tone ? `${ANSI[tone]}${text}${ANSI.reset}` : text);
  const warnRatio = validPositive(config.warnThresholdPct) ? Math.min(config.warnThresholdPct, 100) / 100 : 0.8;
  const tone = (ratio) => (ratio >= 1 ? 'red' : ratio >= warnRatio ? 'amber' : null);
  const parts = [];

  if (session && session.messageCount > 0) {
    const sessionCap = config.sessionCostCapUsd;
    const sessionCost = `${session.estimated ? '≈' : ''}${formatCost(session.costUsd)}`;
    parts.push(validPositive(sessionCap)
      ? paint(`${sessionCost}/${formatCost(sessionCap)} session`, tone(session.costUsd / sessionCap))
      : `${sessionCost} session`);
    parts.push(`${formatCompact(session.tokenTotal)} tok`);

    const cacheBase = session.inputTokens + session.cacheCreationInputTokens + session.cacheReadInputTokens;
    if (cacheBase > 0) parts.push(`cache ${Math.round((session.cacheReadInputTokens / cacheBase) * 100)}%`);

    const windowSize = contextWindowFor(model || session.latestModel, session.maxPromptTokens);
    const contextRatio = session.latestPromptTokens / windowSize;
    if (session.latestPromptTokens > 0) {
      parts.push(paint(`ctx ${Math.min(100, Math.round(contextRatio * 100))}%`, contextRatio >= 0.8 ? 'red' : contextRatio >= 0.6 ? 'amber' : null));
    }
  } else {
    parts.push(paint('no usage yet this session', 'dim'));
  }

  if (planWindow && planWindow.idle) {
    parts.push(paint('5h idle', 'dim'));
  } else if (planWindow) {
    const limit = config.blockTokenLimit;
    const reset = `resets ${formatMinutes(planWindow.remainingMinutes)}`;
    parts.push(validPositive(limit)
      ? paint(`5h ${Math.round((planWindow.tokenTotal / limit) * 100)}% ${reset}`, tone(planWindow.tokenTotal / limit))
      : `5h ${formatCompact(planWindow.tokenTotal)} tok ${reset}`);
  }

  if (today) {
    const plus = today.partial ? '+' : '';
    const todayCost = `${today.estimated ? '≈' : ''}${formatCost(today.costUsd)}${plus}`;
    if (validPositive(config.dailyCostCapUsd)) {
      const ratio = today.costUsd / config.dailyCostCapUsd;
      parts.push(paint(`today ${todayCost}/${formatCost(config.dailyCostCapUsd)} (${Math.round(ratio * 100)}%)`, tone(ratio)));
    } else if (validPositive(config.dailyTokenCap)) {
      const ratio = today.tokenTotal / config.dailyTokenCap;
      parts.push(paint(`today ${formatCompact(today.tokenTotal)}${plus}/${formatCompact(config.dailyTokenCap)} tok (${Math.round(ratio * 100)}%)`, tone(ratio)));
    } else {
      parts.push(`today ${todayCost}`);
    }
  }

  return `◆ ${parts.join(' · ')}`;
}

function formatMinutes(minutes) {
  const total = Math.max(0, Math.round(Number.isFinite(minutes) ? minutes : 0));
  const hours = Math.floor(total / 60);
  return hours ? `${hours}h${String(total % 60).padStart(2, '0')}m` : `${total}m`;
}

function validPositive(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function formatCost(value) {
  const number = Number.isFinite(value) ? value : 0;
  if (number > 0 && number < 0.01) return '<$0.01';
  return `$${number.toFixed(2)}`;
}

export function formatCompact(value) {
  const number = Number.isFinite(value) ? value : 0;
  const abs = Math.abs(number);
  const trim = (n, digits) => n.toFixed(digits).replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1');
  if (abs >= 1e9) return `${trim(number / 1e9, 2)}B`;
  if (abs >= 1e6) return `${trim(number / 1e6, 2)}M`;
  if (abs >= 1e3) return `${trim(number / 1e3, 1)}K`;
  return String(Math.round(number));
}
