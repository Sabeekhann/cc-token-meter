/**
 * Flag sessions with 60+ assistant messages that show no sign of a
 * /compact having been run.
 *
 * NOTE (unverified): the exact on-disk shape of a `/compact` invocation and
 * any resulting system notice was NOT verified against a real transcript
 * during planning of this tool. We defensively check two signals:
 *   1. A `user`-type line whose raw text content starts with the literal
 *      string "/compact".
 *   2. A `system`-type line whose content mentions "compact" (case-
 *      insensitive), as a secondary/looser signal.
 * Both checks are best-effort. This should be validated against a real
 * `/compact`-containing transcript before relying on it in production —
 * false negatives (missing a real compact event, causing a spurious tip)
 * are more likely than false positives here.
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

  if (compactDetected) return [];

  return [
    {
      id: `longSessionNoCompact:${sessionRecord.sessionId}`,
      sessionId: sessionRecord.sessionId,
      severity: 'warn',
      message: `This session has run ${messageCount} turns without a /compact. Long uncompacted sessions tend to accumulate stale context, inflating cache-write costs. Consider running /compact soon.`,
    },
  ];
}

/**
 * Best-effort compact-event detection. Accepts either a pre-computed
 * boolean flag on the session aggregate (`sessionRecord.compactDetected`,
 * if a caller has already scanned raw lines elsewhere) or a raw lines
 * array to scan directly.
 */
function detectCompactEvent(rawLines, precomputedFlag) {
  if (typeof precomputedFlag === 'boolean') return precomputedFlag;
  if (!Array.isArray(rawLines) || rawLines.length === 0) return false;

  for (const line of rawLines) {
    if (!line || typeof line !== 'object') continue;

    if (line.type === 'user') {
      const text = extractTextContent(line);
      if (typeof text === 'string' && text.trim().startsWith('/compact')) {
        return true;
      }
    }

    if (line.type === 'system') {
      const text = extractTextContent(line);
      if (typeof text === 'string' && text.toLowerCase().includes('compact')) {
        return true;
      }
    }
  }

  return false;
}

function extractTextContent(line) {
  if (typeof line.content === 'string') return line.content;
  if (line.message && typeof line.message.content === 'string') return line.message.content;
  if (line.message && Array.isArray(line.message.content)) {
    return line.message.content
      .filter((b) => b && typeof b.text === 'string')
      .map((b) => b.text)
      .join(' ');
  }
  return null;
}

export { detectCompactEvent };
