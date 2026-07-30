import { repeatedReads } from './repeatedReads.js';
import { cacheRatio } from './cacheRatio.js';
import { longSessionNoCompact } from './longSessionNoCompact.js';
import { outlierSessionTotal } from './outlierSessionTotal.js';
import { largeToolResultSpike } from './largeToolResultSpike.js';

// Per-session cache of heuristic results, keyed by sessionId. Recomputed
// only when the session's message count (or, as a finer-grained signal,
// its tool-event count) has changed since the last computation — this
// avoids re-running all 5 heuristics every ~1.5s poll tick for sessions
// that are currently idle.
const heuristicsCache = new Map(); // sessionId -> { lastComputedAtMessageCount, lastComputedAtToolEventCount, tips }

/**
 * Run all 5 heuristics against a single session and return the combined
 * tip list. Uses a per-session cache to avoid recomputing for unchanged
 * sessions.
 *
 * @param {object} sessionRecord
 * @param {Array<object>} toolEvents
 * @param {Array<object>} allSessionsHistory
 * @param {Array<object>} [rawLines] optional raw parsed lines (for longSessionNoCompact's compact detection)
 * @returns {Array<object>} Tip[]
 */
export function runHeuristics(sessionRecord, toolEvents, allSessionsHistory, rawLines = []) {
  const sessionId = sessionRecord.sessionId;
  const messageCount = sessionRecord.messageCount || 0;
  const toolEventCount = toolEvents.length;

  const cached = heuristicsCache.get(sessionId);
  if (
    cached &&
    cached.lastComputedAtMessageCount === messageCount &&
    cached.lastComputedAtToolEventCount === toolEventCount
  ) {
    return cached.tips;
  }

  const tips = [
    ...repeatedReads(sessionRecord, toolEvents, allSessionsHistory),
    ...cacheRatio(sessionRecord, toolEvents, allSessionsHistory),
    ...longSessionNoCompact(sessionRecord, toolEvents, allSessionsHistory, rawLines),
    ...outlierSessionTotal(sessionRecord, toolEvents, allSessionsHistory),
    ...largeToolResultSpike(sessionRecord, toolEvents, allSessionsHistory),
  ];

  heuristicsCache.set(sessionId, {
    lastComputedAtMessageCount: messageCount,
    lastComputedAtToolEventCount: toolEventCount,
    tips,
  });

  return tips;
}

/** Clears the module-level cache — primarily useful for tests. */
export function clearHeuristicsCache() {
  heuristicsCache.clear();
}

export { repeatedReads, cacheRatio, longSessionNoCompact, outlierSessionTotal, largeToolResultSpike };
