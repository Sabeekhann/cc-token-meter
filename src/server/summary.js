// Copyright 2026 FiveNodes
// SPDX-License-Identifier: Apache-2.0

import {
  aggregateByProject,
  aggregateByBranch,
  aggregateByDay,
  aggregateByHourOfWeek,
  getTodayTotal,
  tokenTotal,
  localDateKey,
  forecastBurnRate,
  buildTimeline,
} from '../ingest/aggregate.js';
import { computeAlerts, computePlanAlerts } from '../budget/alerts.js';
import { readConfig } from '../budget/config.js';
import { runHeuristics } from '../heuristics/index.js';
import { buildUsageIntelligence } from '../analytics/overview.js';
import { buildPlanIntelligence } from '../analytics/plan.js';
import { buildWhatIf } from '../analytics/whatIf.js';
import { filterSessions, normalizeSummaryFilters } from '../analytics/filters.js';
import { PRICING_VERIFIED_ON } from '../pricing/models.js';

const storeCacheNamespaces = new WeakMap();
let nextStoreCacheNamespace = 1;

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
  const heuristicContextKey = buildHeuristicContextKey(store, snapshot, filters);
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
    lastTimestamp: s.lastTimestamp,
  }));

  const intelligence = buildUsageIntelligence(sessions, { now: generatedAt });
  // Subscription windows are account-wide, so plan intelligence always uses
  // every session rather than the filtered scope.
  const filtered = Boolean(filters.from || filters.to || filters.project || filters.model);
  const plan = buildPlanIntelligence(snapshot.sessions, config, {
    now: generatedAt,
    byDay: filtered ? undefined : byDay,
  });

  // Session caps apply to sessions that ran today; finished history would
  // otherwise raise the same alerts forever.
  const todayKey = localDateKey(generatedAt);
  const alerts = [
    ...computeAlerts(
      { tokenTotal: todayTotal.tokenTotal, costUsd: todayTotal.costUsd },
      activeSessionTotals.filter((s) => s.lastTimestamp && localDateKey(s.lastTimestamp) === todayKey),
      config
    ),
    ...computePlanAlerts(plan, config),
  ];

  const tips = [];
  for (const s of sessions) {
    const sessionTips = runHeuristics(
      s,
      s.toolEvents || [],
      sessions,
      [],
      { contextKey: heuristicContextKey },
    );
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
      estimatedCostUsed: p.sessions.some((s) => s.estimatedCostUsed === true),
      sessions: p.sessions.map((s) => ({
        sessionId: s.sessionId,
        messageCount: s.messageCount,
        tokenTotal: tokenTotal(s),
        costUsd: s.costUsd,
        estimatedCostUsed: s.estimatedCostUsed === true,
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
    byHourOfWeek: aggregateByHourOfWeek(sessions),
    forecast,
    intelligence,
    plan,
    whatIf: buildWhatIf(sessions, { now: generatedAt }),
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

function buildHeuristicContextKey(store, snapshot, filters) {
  let namespace = storeCacheNamespaces.get(store);
  if (!namespace) {
    namespace = nextStoreCacheNamespace;
    nextStoreCacheNamespace += 1;
    storeCacheNamespaces.set(store, namespace);
  }

  const revision = Number.isInteger(snapshot.revision)
    ? snapshot.revision
    : snapshot.totalIngestedMessages || 0;
  return `${namespace}:${revision}:${JSON.stringify(filters)}`;
}
