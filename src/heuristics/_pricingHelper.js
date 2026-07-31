import { matchModelRow } from '../pricing/cost.js';

/**
 * Approximate USD-per-token input rate for a session, derived from the
 * most recently used model (falls back to the pricing table's default row
 * via matchModelRow if the model is unrecognized/missing). Shared by any
 * heuristic that needs to convert a token-savings estimate into a rough
 * USD figure.
 *
 * @param {object} sessionRecord needs `models` (array) and `lastTimestamp`
 * @returns {number} USD per token, using the session's matched input rate
 */
export function sessionInputRatePerToken(sessionRecord) {
  const models = Array.isArray(sessionRecord.models) ? sessionRecord.models : [];
  const model = models.length > 0 ? models[models.length - 1] : null;
  const { row } = matchModelRow(model, sessionRecord.lastTimestamp);
  return row.inputPerMTok / 1_000_000;
}
