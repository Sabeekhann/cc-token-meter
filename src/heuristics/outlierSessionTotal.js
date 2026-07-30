import { computeCost } from '../pricing/cost.js';

/**
 * Flag a session whose total token count exceeds the 90th percentile of
 * the user's own historical session totals. Requires at least 5 historical
 * sessions (excluding the session under evaluation) to compute a
 * meaningful percentile.
 *
 * @param {object} sessionRecord needs sessionId, token fields, costUsd
 * @param {Array<object>} toolEvents unused here
 * @param {Array<object>} allSessionsHistory all known sessions (including this one)
 * @returns {Array<object>} Tip[]
 */
export function outlierSessionTotal(sessionRecord, toolEvents, allSessionsHistory) {
  const history = (allSessionsHistory || []).filter((s) => s.sessionId !== sessionRecord.sessionId);

  if (history.length < 5) return [];

  const historicalTotals = history.map(sessionTokenTotal).sort((a, b) => a - b);
  const p90 = percentile(historicalTotals, 90);

  const thisTotal = sessionTokenTotal(sessionRecord);

  if (thisTotal <= p90) return [];

  const cost = sessionRecord.costUsd != null ? sessionRecord.costUsd : estimateSessionCost(sessionRecord);

  return [
    {
      id: `outlierSessionTotal:${sessionRecord.sessionId}`,
      sessionId: sessionRecord.sessionId,
      severity: 'info',
      message: `This session has used ${Math.round(thisTotal).toLocaleString()} tokens (~$${cost.toFixed(2)}), more than 90% of your past sessions. If this is a single large task, consider splitting it across multiple focused sessions.`,
    },
  ];
}

function sessionTokenTotal(s) {
  return (
    (s.inputTokens || 0) +
    (s.outputTokens || 0) +
    (s.cacheCreationInputTokens || 0) +
    (s.cacheReadInputTokens || 0)
  );
}

function estimateSessionCost(sessionRecord) {
  if (!Array.isArray(sessionRecord.usageRecords)) return 0;
  return sessionRecord.usageRecords.reduce((sum, r) => sum + computeCost(r).totalCost, 0);
}

/**
 * Nearest-rank percentile (simple, deterministic, no interpolation
 * dependency) over a sorted ascending array.
 */
function percentile(sortedArr, pct) {
  if (sortedArr.length === 0) return 0;
  const rank = Math.ceil((pct / 100) * sortedArr.length);
  const index = Math.min(sortedArr.length - 1, Math.max(0, rank - 1));
  return sortedArr[index];
}

export { percentile };
