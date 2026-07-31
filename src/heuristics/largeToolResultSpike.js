import { sessionInputRatePerToken } from './_pricingHelper.js';

/** Byte-size threshold above which a tool_result is considered "large". */
export const LARGE_RESULT_BYTE_THRESHOLD = 50000;

/**
 * Rough bytes-per-token approximation used to convert a tool_result's byte
 * size into an estimated token count. This is a coarse approximation (real
 * tokenization varies by content), documented here rather than hidden as a
 * bare literal.
 */
export const BYTES_PER_TOKEN_ESTIMATE = 4;

/**
 * Flag a large tool_result (>50KB) that immediately precedes an assistant
 * message with an unusually large output-token count (top 10% of that
 * session's own output-token distribution). "Immediately precedes" means:
 * find the tool_result's matching tool_use by toolUseId, then find the
 * next assistant message chronologically AFTER that tool_result.
 *
 * Requires ≥10 assistant messages in the session to compute a meaningful
 * distribution.
 *
 * @param {object} sessionRecord needs sessionId, usageRecords (chronological)
 * @param {Array<object>} toolEvents tool_use and tool_result events (ring buffer, chronological-ish)
 * @returns {Array<object>} Tip[]
 */
export function largeToolResultSpike(sessionRecord, toolEvents) {
  const records = Array.isArray(sessionRecord.usageRecords) ? sessionRecord.usageRecords : [];
  if (records.length < 10) return [];

  const sortedRecords = records
    .slice()
    .filter((r) => r.timestamp)
    .sort((a, b) => compareTimestamps(a.timestamp, b.timestamp));

  const outputTokenCounts = sortedRecords.map((r) => r.outputTokens || 0).sort((a, b) => a - b);
  const p90Threshold = percentileValue(outputTokenCounts, 90);

  const toolUseEvents = toolEvents.filter((e) => e.kind === 'tool_use');
  const toolResultEvents = toolEvents
    .filter((e) => e.kind === 'tool_result' && e.contentByteLength > LARGE_RESULT_BYTE_THRESHOLD)
    .slice()
    .sort((a, b) => compareTimestamps(a.timestamp, b.timestamp));

  const tips = [];
  const seen = new Set();

  for (const resultEvt of toolResultEvents) {
    // Find the matching tool_use by id — mainly to confirm correlation
    // and to have a stable identity for the tip; not otherwise used
    // beyond that, since the timestamp we key off of is the tool_result's
    // own timestamp (the tool_use timestamp precedes it).
    const matchingUse = toolUseEvents.find((u) => u.toolUseId === resultEvt.toolUseId);
    if (!matchingUse) continue;

    // Find the next assistant message chronologically AFTER this tool_result.
    const nextAssistantMsg = sortedRecords.find(
      (r) => r.timestamp && resultEvt.timestamp && r.timestamp > resultEvt.timestamp
    );

    if (!nextAssistantMsg) continue;
    // Require the output to strictly exceed the 90th-percentile value, not
    // merely meet it — otherwise a perfectly uniform distribution (every
    // message the same size) would spuriously flag every message as "top
    // 10%" since the percentile value equals every data point.
    if ((nextAssistantMsg.outputTokens || 0) <= p90Threshold) continue;

    const dedupeKey = `${resultEvt.toolUseId}:${nextAssistantMsg.timestamp}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const kb = Math.round(resultEvt.contentByteLength / 1024);

    const bytesOverThreshold = resultEvt.contentByteLength - LARGE_RESULT_BYTE_THRESHOLD;
    const estimatedSavingsTokens = Math.round(bytesOverThreshold / BYTES_PER_TOKEN_ESTIMATE);
    const estimatedSavingsUsd = estimatedSavingsTokens * sessionInputRatePerToken(sessionRecord);

    tips.push({
      id: `largeToolResultSpike:${sessionRecord.sessionId}:${dedupeKey}`,
      sessionId: sessionRecord.sessionId,
      severity: 'info',
      message: `A tool call returned a very large result (~${kb}KB of output) right before an unusually long response. If this was a file read or command output, consider using offset/limit, grep for specific content, or truncating the tool output rather than passing it through in full. That's roughly ${estimatedSavingsTokens.toLocaleString()} extra tokens (~$${estimatedSavingsUsd.toFixed(2)}) above the ${Math.round(LARGE_RESULT_BYTE_THRESHOLD / 1024)}KB threshold.`,
      estimatedSavingsTokens,
      estimatedSavingsUsd,
    });
  }

  return tips;
}

function percentileValue(sortedArr, pct) {
  if (sortedArr.length === 0) return Infinity;
  const rank = Math.ceil((pct / 100) * sortedArr.length);
  const index = Math.min(sortedArr.length - 1, Math.max(0, rank - 1));
  return sortedArr[index];
}

function compareTimestamps(a, b) {
  if (!a || !b) return 0;
  return a < b ? -1 : a > b ? 1 : 0;
}
