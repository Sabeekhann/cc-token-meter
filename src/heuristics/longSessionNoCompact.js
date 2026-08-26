import { createInsight } from './contract.js';
import { detectCompactEvent } from '../ingest/compact.js';

/**
 * Flag sessions with 60+ assistant messages that show no sign of a
 * /compact having been run.
 *
 * Compact detection is populated during streaming ingestion. Legacy cached
 * sessions may not have that evidence, so this heuristic deliberately stays
 * silent unless the absence of a compact event is known.
 *
 * @param {object} sessionRecord needs sessionId, messageCount
 * @param {Array<object>} toolEvents unused here, kept for consistent heuristic signature
 * @param {Array<object>} allSessionsHistory unused here
 * @param {Array<object>} [rawLines] optional raw parsed transcript lines for compact detection
 * @returns {Array<object>} Tip[]
 */
export function longSessionNoCompact(sessionRecord, toolEvents, allSessionsHistory, rawLines = []) {
  const messageCount = sessionRecord.messageCount || 0;
  if (messageCount < 60) return [];

  const compactDetected = detectCompactEvent(rawLines, sessionRecord.compactDetected);

  if (compactDetected !== false) return [];

  return [
    createInsight({
      id: `longSessionNoCompact:${sessionRecord.sessionId}`,
      sessionId: sessionRecord.sessionId,
      severity: 'warn',
      message: `This session has run ${messageCount} turns without a /compact. Long uncompacted sessions tend to accumulate stale context, inflating cache-write costs. Consider running /compact soon.`,
      action: 'Run /compact before continuing long-running work.',
      scope: { type: 'session', id: sessionRecord.sessionId },
      confidence: {
        level: 'medium',
        score: 0.75,
        basis: 'Assistant message count plus best-effort compact-event detection.',
      },
      evidence: [
        { metric: 'assistant_message_count', value: messageCount, unit: 'messages', kind: 'measured' },
        { metric: 'compact_event_detected', value: false, unit: 'boolean', kind: 'measured' },
      ],
    }),
  ];
}

/**
 * Re-exported for existing callers and focused heuristic tests.
 */
export { detectCompactEvent } from '../ingest/compact.js';
