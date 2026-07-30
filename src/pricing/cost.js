import {
  PRICING_TABLE,
  FALLBACK_ROW,
  CACHE_WRITE_5M_MULTIPLIER,
  CACHE_WRITE_1H_MULTIPLIER,
  CACHE_READ_MULTIPLIER,
} from './models.js';

/**
 * Find the pricing row that matches a model string (by substring) and a
 * timestamp (must fall within the row's effectiveFrom/effectiveUntil
 * bounds, if set). Returns { row, estimated } where `estimated` is true if
 * we had to fall back to the default pricing row because nothing matched.
 *
 * @param {string|null|undefined} model
 * @param {string|null|undefined} timestamp ISO timestamp string
 * @param {Array<object>} [table] pricing table to use (injectable for tests)
 */
export function matchModelRow(model, timestamp, table = PRICING_TABLE) {
  const normalizedModel = typeof model === 'string' ? model.toLowerCase() : '';
  const ts = timestamp ? Date.parse(timestamp) : NaN;

  const candidates = table.filter((row) =>
    row.matchSubstrings.some((sub) => normalizedModel.includes(sub))
  );

  if (candidates.length === 0) {
    return { row: FALLBACK_ROW, estimated: true };
  }

  // Among candidates, pick the one whose effective date range contains the
  // timestamp. effectiveFrom is inclusive; effectiveUntil is exclusive
  // (i.e. the row stops applying exactly at effectiveUntil).
  for (const row of candidates) {
    const fromOk = !row.effectiveFrom || Number.isNaN(ts) || ts >= Date.parse(row.effectiveFrom);
    const untilOk = !row.effectiveUntil || Number.isNaN(ts) || ts < Date.parse(row.effectiveUntil);
    if (fromOk && untilOk) {
      return { row, estimated: false };
    }
  }

  // No candidate's date range matched (e.g. timestamp missing/unparseable,
  // or falls in a gap) — use the first candidate as a best-effort match,
  // still not flagged as "estimated" since the model itself matched (the
  // date-range miss is a lesser concern for cost display purposes).
  return { row: candidates[0], estimated: false };
}

/**
 * Compute the cost breakdown for a single normalized usage record.
 *
 * @param {{
 *   model: string|null,
 *   timestamp: string|null,
 *   inputTokens: number,
 *   outputTokens: number,
 *   cacheWrite5m: number,
 *   cacheWrite1h: number,
 *   cacheReadInputTokens: number,
 * }} usageRecord
 * @param {Array<object>} [table] pricing table to use (injectable for tests)
 * @returns {{
 *   inputCost: number,
 *   outputCost: number,
 *   cacheWrite5mCost: number,
 *   cacheWrite1hCost: number,
 *   cacheReadCost: number,
 *   totalCost: number,
 *   estimated: boolean,
 * }}
 */
export function computeCost(usageRecord, table = PRICING_TABLE) {
  const { row, estimated } = matchModelRow(usageRecord.model, usageRecord.timestamp, table);

  const inputTokens = numOr0(usageRecord.inputTokens);
  const outputTokens = numOr0(usageRecord.outputTokens);
  const cacheWrite5m = numOr0(usageRecord.cacheWrite5m);
  const cacheWrite1h = numOr0(usageRecord.cacheWrite1h);
  const cacheReadTokens = numOr0(usageRecord.cacheReadInputTokens);

  const baseInputRate = row.inputPerMTok / 1_000_000;
  const outputRate = row.outputPerMTok / 1_000_000;
  const cacheWrite5mRate = baseInputRate * CACHE_WRITE_5M_MULTIPLIER;
  const cacheWrite1hRate = baseInputRate * CACHE_WRITE_1H_MULTIPLIER;
  const cacheReadRate = baseInputRate * CACHE_READ_MULTIPLIER;

  const inputCost = inputTokens * baseInputRate;
  const outputCost = outputTokens * outputRate;
  const cacheWrite5mCost = cacheWrite5m * cacheWrite5mRate;
  const cacheWrite1hCost = cacheWrite1h * cacheWrite1hRate;
  const cacheReadCost = cacheReadTokens * cacheReadRate;

  const totalCost = inputCost + outputCost + cacheWrite5mCost + cacheWrite1hCost + cacheReadCost;

  return {
    inputCost,
    outputCost,
    cacheWrite5mCost,
    cacheWrite1hCost,
    cacheReadCost,
    totalCost,
    estimated,
  };
}

function numOr0(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
