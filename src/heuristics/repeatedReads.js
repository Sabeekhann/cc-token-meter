/**
 * Flag files that were Read 3+ times within a session with no intervening
 * Edit/Write/MultiEdit on that same file between any of those reads.
 *
 * @param {object} sessionRecord aggregate session object (needs sessionId)
 * @param {Array<{kind: string, name: string, filePath: string|null, timestamp: string|null}>} toolEvents
 * @returns {Array<{id: string, sessionId: string, severity: string, message: string}>}
 */
export function repeatedReads(sessionRecord, toolEvents) {
  const tips = [];

  // Only tool_use events matter here; sort chronologically by timestamp
  // (fall back to array order if timestamps are missing/equal).
  const toolUseEvents = toolEvents
    .filter((e) => e.kind === 'tool_use' && e.filePath)
    .slice()
    .sort((a, b) => compareTimestamps(a.timestamp, b.timestamp));

  // Group by file path.
  const byFile = new Map();
  for (const evt of toolUseEvents) {
    if (!byFile.has(evt.filePath)) byFile.set(evt.filePath, []);
    byFile.get(evt.filePath).push(evt);
  }

  for (const [filePath, events] of byFile.entries()) {
    const reads = events.filter((e) => e.name === 'Read');
    if (reads.length < 3) continue;

    // Check whether an Edit/Write/MultiEdit occurred on this file between
    // any two reads (chronologically) — if so, the counter resets and this
    // doesn't trigger (per spec: "no Edit/Write/MultiEdit ... occurring
    // between any of those reads").
    const hasInterveningEdit = events.some((e) => ['Edit', 'Write', 'MultiEdit'].includes(e.name));

    if (hasInterveningEdit) continue;

    tips.push({
      id: `repeatedReads:${sessionRecord.sessionId}:${filePath}`,
      sessionId: sessionRecord.sessionId,
      severity: 'info',
      message: `You read ${filePath} ${reads.length} times in this session without editing it in between. Consider keeping relevant excerpts in context, or use targeted Grep/offset+limit reads instead of full re-reads.`,
    });
  }

  return tips;
}

function compareTimestamps(a, b) {
  if (!a || !b) return 0;
  return a < b ? -1 : a > b ? 1 : 0;
}
