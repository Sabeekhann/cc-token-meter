import { repeatedReads } from './repeatedReads.js';
import { cacheRatio } from './cacheRatio.js';
import { longSessionNoCompact, detectCompactEvent } from './longSessionNoCompact.js';
import { outlierSessionTotal } from './outlierSessionTotal.js';
import { largeToolResultSpike } from './largeToolResultSpike.js';
import { rankAndDedupeInsights } from './contract.js';

// Per-session cache of heuristic results, keyed by sessionId. Recomputed
// only when the session's message count (or, as a finer-grained signal,
// its tool-event count) has changed since the last computation — this
// avoids re-running all 5 heuristics every ~1.5s poll tick for sessions
// that are currently idle.
const heuristicsCache = new Map(); // sessionId -> { contextKey, lastComputedAtMessageCount, lastComputedAtToolEventCount, compactDetectionState, tips }

/**
 * Run all 5 heuristics against a single session and return the combined
 * tip list. Uses a per-session cache to avoid recomputing for unchanged
 * sessions.
 *
 * @param {object} sessionRecord
 * @param {Array<object>} toolEvents
 * @param {Array<object>} allSessionsHistory
 * @param {Array<object>} [rawLines] optional raw parsed lines (for longSessionNoCompact's compact detection)
 * @param {{contextKey?: string|number|null}} [options] cache namespace for the
 * current store revision and filter scope
 * @returns {Array<{
 *   id: string,
 *   sessionId: string,
 *   severity: string,
 *   message: string,
 *   estimatedSavingsTokens: number|null,
 *   estimatedSavingsUsd: number|null,
 * }>} Tip[]
 */
export function runHeuristics(
  sessionRecord,
  toolEvents,
  allSessionsHistory,
  rawLines = [],
  options = {},
) {
  const sessionId = sessionRecord.sessionId;
  const messageCount = sessionRecord.messageCount || 0;
  const toolEventCount = toolEvents.length;
  const compactDetectionState = detectCompactEvent(rawLines, sessionRecord.compactDetected);
  const contextKey = options.contextKey ?? null;

  const cached = heuristicsCache.get(sessionId);
  if (
    cached &&
    cached.contextKey === contextKey &&
    cached.lastComputedAtMessageCount === messageCount &&
    cached.lastComputedAtToolEventCount === toolEventCount &&
    cached.compactDetectionState === compactDetectionState
  ) {
    return cached.tips;
  }

  const tips = rankAndDedupeInsights([
    ...repeatedReads(sessionRecord, toolEvents, allSessionsHistory),
    ...cacheRatio(sessionRecord, toolEvents, allSessionsHistory),
    ...longSessionNoCompact(sessionRecord, toolEvents, allSessionsHistory, rawLines),
    ...outlierSessionTotal(sessionRecord, toolEvents, allSessionsHistory),
    ...largeToolResultSpike(sessionRecord, toolEvents, allSessionsHistory),
  ]);

  heuristicsCache.set(sessionId, {
    contextKey,
    lastComputedAtMessageCount: messageCount,
    lastComputedAtToolEventCount: toolEventCount,
    compactDetectionState,
    tips,
  });

  return tips;
}

/** Clears the module-level cache — primarily useful for tests. */
export function clearHeuristicsCache() {
  heuristicsCache.clear();
}

export { repeatedReads, cacheRatio, longSessionNoCompact, outlierSessionTotal, largeToolResultSpike };
export { assertInsightContract, createInsight, rankAndDedupeInsights } from './contract.js';
