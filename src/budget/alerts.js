/**
 * Compute budget alerts for the current state against a user's configured
 * caps. Pure function — no I/O.
 *
 * @param {{tokenTotal: number, costUsd: number}} todayTotal
 * @param {Array<{sessionId: string, tokenTotal: number, costUsd: number}>} activeSessionTotals
 * @param {{dailyTokenCap: number|null, dailyCostCapUsd: number|null, sessionTokenCap: number|null, sessionCostCapUsd: number|null, warnThresholdPct: number}} config
 * Each alert carries a stable `id` naming what it measures (for example
 * `day-cost` or `session-cost:<sessionId>`), so clients can tell a new alert
 * from one they have already shown.
 *
 * @returns {Array<{id: string, level: 'warn'|'exceeded', scope: 'day'|'session', message: string}>}
 */
export function computeAlerts(todayTotal, activeSessionTotals, config) {
  const alerts = [];
  const evaluate = createEvaluator(alerts, config);

  evaluate('day-tokens', 'day', "Today's token usage", todayTotal.tokenTotal, config.dailyTokenCap, 'tokens');
  evaluate('day-cost', 'day', "Today's cost", todayTotal.costUsd, config.dailyCostCapUsd, 'usd');

  for (const session of activeSessionTotals) {
    evaluate(
      `session-tokens:${session.sessionId}`,
      'session',
      `Session ${shortId(session.sessionId)} token usage`,
      session.tokenTotal,
      config.sessionTokenCap,
      'tokens'
    );
    evaluate(
      `session-cost:${session.sessionId}`,
      'session',
      `Session ${shortId(session.sessionId)} cost`,
      session.costUsd,
      config.sessionCostCapUsd,
      'usd'
    );
  }

  return alerts;
}

/**
 * Alerts for subscription plan limits that the user set. Only user-set
 * limits produce alerts: the personal-record baseline is a comparison, not
 * a limit. A window that is not over its limit yet but is on pace to pass
 * it by reset gets a warning of its own.
 *
 * @param {ReturnType<import('../analytics/plan.js').buildPlanIntelligence>|null} plan
 * @param {{warnThresholdPct?: number}} config
 * @returns {Array<{id: string, level: 'warn'|'exceeded', scope: 'window'|'week', message: string}>}
 */
export function computePlanAlerts(plan, config) {
  const alerts = [];
  if (!plan || plan.plan === 'api') return alerts;
  const evaluate = createEvaluator(alerts, config);
  const block = plan.currentBlock;

  if (block && block.referenceKind === 'limit') {
    const id = `window-tokens:${block.start}`;
    const before = alerts.length;
    evaluate(id, 'window', 'This 5-hour window', block.tokenTotal, block.reference, 'tokens');
    if (alerts.length === before && block.projectedTokens >= block.reference) {
      alerts.push({
        id: `window-pace:${block.start}`,
        level: 'warn',
        scope: 'window',
        message: `At the current pace this 5-hour window reaches ${formatUnit(block.projectedTokens, 'tokens')} before it resets, above your ${formatUnit(block.reference, 'tokens')} limit.`,
      });
    }
  }

  if (plan.weekly && plan.weekly.limit) {
    evaluate('week-tokens', 'week', 'Your rolling 7-day usage', plan.weekly.tokenTotal, plan.weekly.limit, 'tokens');
  }

  return alerts;
}

function createEvaluator(alerts, config) {
  const warnThresholdPct = typeof config.warnThresholdPct === 'number' ? config.warnThresholdPct : 80;
  return function evaluate(id, scope, label, actual, cap, unit) {
    if (cap === null || cap === undefined || cap <= 0) return;
    const pct = (actual / cap) * 100;
    if (pct >= 100) {
      alerts.push({
        id,
        level: 'exceeded',
        scope,
        message: `${label} has exceeded its cap: ${formatUnit(actual, unit)} / ${formatUnit(cap, unit)} (${pct.toFixed(0)}%).`,
      });
    } else if (pct >= warnThresholdPct) {
      alerts.push({
        id,
        level: 'warn',
        scope,
        message: `${label} is at ${pct.toFixed(0)}% of its cap: ${formatUnit(actual, unit)} / ${formatUnit(cap, unit)}.`,
      });
    }
  };
}

function shortId(sessionId) {
  if (!sessionId) return 'unknown';
  return sessionId.slice(0, 8);
}

function formatUnit(value, unit) {
  if (unit === 'usd') return `$${value.toFixed(2)}`;
  return `${Math.round(value).toLocaleString()} tokens`;
}
