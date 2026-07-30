import { aggregateByProject, aggregateByDay, getTodayTotal, tokenTotal } from '../ingest/aggregate.js';
import { computeAlerts } from '../budget/alerts.js';
import { readConfig } from '../budget/config.js';
import { runHeuristics } from '../heuristics/index.js';

/**
 * Build the full summary object served by GET /api/summary and streamed by
 * GET /api/stream. Also reused directly by the `--json` CLI command so the
 * shape is identical between the CLI and the dashboard.
 *
 * @param {ReturnType<import('../ingest/store.js').createStore>} store
 * @returns {object}
 */
export function buildSummary(store) {
  const snapshot = store.getSnapshot();
  const sessions = snapshot.sessions;

  const config = readConfig();

  const todayTotal = getTodayTotal(sessions);
  const byProject = aggregateByProject(sessions);
  const byDay = aggregateByDay(sessions);

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

  const tips = [];
  for (const s of sessions) {
    const sessionTips = runHeuristics(s, s.toolEvents || [], sessions);
    tips.push(...sessionTips);
  }

  return {
    generatedAt: new Date().toISOString(),
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
    byDay,
    sessions: sessionSummaries,
    tips,
    alerts,
    config,
    totalIngestedMessages: snapshot.totalIngestedMessages,
  };
}
