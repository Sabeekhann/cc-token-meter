// Copyright 2026 FiveNodes
// SPDX-License-Identifier: Apache-2.0

import {
  aggregateByProject,
  aggregateByBranch,
  aggregateByDay,
  getTodayTotal,
  tokenTotal,
  forecastBurnRate,
  buildTimeline,
} from '../ingest/aggregate.js';
import { computeAlerts } from '../budget/alerts.js';
import { readConfig } from '../budget/config.js';
import { runHeuristics } from '../heuristics/index.js';
import { buildUsageIntelligence } from '../analytics/overview.js';
import { filterSessions, normalizeSummaryFilters } from '../analytics/filters.js';
import { PRICING_VERIFIED_ON } from '../pricing/models.js';

/**
 * Build the full summary object served by GET /api/summary and streamed by
 * GET /api/stream. Also reused directly by the `--json` CLI command so the
 * shape is identical between the CLI and the dashboard.
 *
 * @param {ReturnType<import('../ingest/store.js').createStore>} store
 * @param {{filters?: {from?: string|null, to?: string|null, project?: string|null, model?: string|null}, config?: object}} [options]
 * @returns {object}
 */
export function buildSummary(store, options = {}) {
  const snapshot = store.getSnapshot();
  const filters = normalizeSummaryFilters(options.filters);
  const sessions = filterSessions(snapshot.sessions, filters);
  const generatedAt = new Date().toISOString();

  const config = options.config ?? readConfig();

  const todayTotal = getTodayTotal(sessions);
  const byProject = aggregateByProject(sessions);
  const byBranch = aggregateByBranch(sessions);
  const byDay = aggregateByDay(sessions);
  const rawForecast = forecastBurnRate(byDay);
  const cap = config.dailyCostCapUsd;
  const exceedsDailyCap =
    rawForecast.daysObserved === 0 || !cap || cap <= 0
      ? null
      : rawForecast.avgDailyCostUsd > cap;
  const forecast = { ...rawForecast, exceedsDailyCap };

  const allTimeTotals = sessions.reduce(
    (acc, s) => {
      acc.inputTokens += s.inputTokens || 0;
      acc.outputTokens += s.outputTokens || 0;
      acc.cacheCreationInputTokens += s.cacheCreationInputTokens || 0;
      acc.cacheReadInputTokens += s.cacheReadInputTokens || 0;
      acc.costUsd += s.costUsd || 0;
      acc.tokenTotal += tokenTotal(s);
      return acc;
    },
    {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      costUsd: 0,
      tokenTotal: 0,
    }
  );

  const sessionSummaries = sessions.map((s) => ({
    sessionId: s.sessionId,
    project: s.projectCwd || s.projectDirNameFallback || 'unknown',
    models: s.models,
    firstTimestamp: s.firstTimestamp,
    lastTimestamp: s.lastTimestamp,
    messageCount: s.messageCount,
    inputTokens: s.inputTokens,
    outputTokens: s.outputTokens,
    cacheCreationInputTokens: s.cacheCreationInputTokens,
    cacheReadInputTokens: s.cacheReadInputTokens,
    cacheWrite5m: s.cacheWrite5m,
    cacheWrite1h: s.cacheWrite1h,
    costUsd: s.costUsd,
    estimatedCostUsed: s.estimatedCostUsed,
    tokenTotal: tokenTotal(s),
    gitBranch: s.gitBranch,
    version: s.version,
    timeline: buildTimeline(s),
  }));

  const activeSessionTotals = sessionSummaries.map((s) => ({
    sessionId: s.sessionId,
    tokenTotal: s.tokenTotal,
    costUsd: s.costUsd,
  }));

  const alerts = computeAlerts(
    { tokenTotal: todayTotal.tokenTotal, costUsd: todayTotal.costUsd },
    activeSessionTotals,
    config
  );
  const intelligence = buildUsageIntelligence(sessions, { now: generatedAt });

  const tips = [];
  for (const s of sessions) {
    const sessionTips = runHeuristics(s, s.toolEvents || [], sessions);
    tips.push(...sessionTips);
  }

  return {
    generatedAt,
    filters,
    pricing: { verifiedOn: PRICING_VERIFIED_ON },
    today: todayTotal,
    allTime: allTimeTotals,
    byProject: byProject.map((p) => ({
      project: p.project,
      inputTokens: p.inputTokens,
      outputTokens: p.outputTokens,
      cacheCreationInputTokens: p.cacheCreationInputTokens,
      cacheReadInputTokens: p.cacheReadInputTokens,
      costUsd: p.costUsd,
      tokenTotal: p.tokenTotal,
      sessions: p.sessions.map((s) => ({
        sessionId: s.sessionId,
        messageCount: s.messageCount,
        tokenTotal: tokenTotal(s),
        costUsd: s.costUsd,
        lastTimestamp: s.lastTimestamp,
      })),
    })),
    byBranch: byBranch.map((b) => ({
      branch: b.branch,
      inputTokens: b.inputTokens,
      outputTokens: b.outputTokens,
      cacheCreationInputTokens: b.cacheCreationInputTokens,
      cacheReadInputTokens: b.cacheReadInputTokens,
      costUsd: b.costUsd,
      tokenTotal: b.tokenTotal,
      sessions: b.sessions.map((s) => ({
        sessionId: s.sessionId,
        messageCount: s.messageCount,
        tokenTotal: tokenTotal(s),
        costUsd: s.costUsd,
        lastTimestamp: s.lastTimestamp,
      })),
    })),
    byDay,
    forecast,
    intelligence,
    sessions: sessionSummaries,
    tips,
    alerts,
    config,
    totalIngestedMessages:
      filters.from || filters.to || filters.project || filters.model
        ? sessions.reduce((sum, session) => sum + (session.messageCount || 0), 0)
        : snapshot.totalIngestedMessages,
  };
}
