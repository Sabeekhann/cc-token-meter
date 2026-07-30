/**
 * Compute budget alerts for the current state against a user's configured
 * caps. Pure function — no I/O.
 *
 * @param {{tokenTotal: number, costUsd: number}} todayTotal
 * @param {Array<{sessionId: string, tokenTotal: number, costUsd: number}>} activeSessionTotals
 * @param {{dailyTokenCap: number|null, dailyCostCapUsd: number|null, sessionTokenCap: number|null, sessionCostCapUsd: number|null, warnThresholdPct: number}} config
 * @returns {Array<{level: 'ok'|'warn'|'exceeded', scope: 'day'|'session', message: string}>}
 */
export function computeAlerts(todayTotal, activeSessionTotals, config) {
  const alerts = [];
  const warnThresholdPct = typeof config.warnThresholdPct === 'number' ? config.warnThresholdPct : 80;

  function evaluate(scope, label, actual, cap, unit) {
    if (cap === null || cap === undefined || cap <= 0) return;
    const pct = (actual / cap) * 100;
    if (pct >= 100) {
      alerts.push({
        level: 'exceeded',
        scope,
        message: `${label} has exceeded its cap: ${formatUnit(actual, unit)} / ${formatUnit(cap, unit)} (${pct.toFixed(0)}%).`,
      });
    } else if (pct >= warnThresholdPct) {
      alerts.push({
        level: 'warn',
        scope,
        message: `${label} is at ${pct.toFixed(0)}% of its cap: ${formatUnit(actual, unit)} / ${formatUnit(cap, unit)}.`,
      });
    }
  }

  evaluate('day', "Today's token usage", todayTotal.tokenTotal, config.dailyTokenCap, 'tokens');
  evaluate('day', "Today's cost", todayTotal.costUsd, config.dailyCostCapUsd, 'usd');

  for (const session of activeSessionTotals) {
    evaluate(
      'session',
      `Session ${shortId(session.sessionId)} token usage`,
      session.tokenTotal,
      config.sessionTokenCap,
      'tokens'
    );
    evaluate(
      'session',
      `Session ${shortId(session.sessionId)} cost`,
      session.costUsd,
      config.sessionCostCapUsd,
      'usd'
    );
  }

  return alerts;
}

function shortId(sessionId) {
  if (!sessionId) return 'unknown';
  return sessionId.slice(0, 8);
}

function formatUnit(value, unit) {
  if (unit === 'usd') return `$${value.toFixed(2)}`;
  return `${Math.round(value).toLocaleString()} tokens`;
}
