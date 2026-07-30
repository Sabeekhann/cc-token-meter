/**
 * Detect a significant drop in cache reuse later in a session: if the mean
 * cache-write/cache-read ratio of the last 25% of assistant messages is
 * ≥2x the mean ratio of the first 25%, the session is likely rebuilding
 * context rather than reusing it.
 *
 * Only evaluated for sessions with ≥20 assistant messages.
 *
 * @param {object} sessionRecord needs sessionId and usageRecords (chronological array)
 * @returns {Array<object>} Tip[]
 */
export function cacheRatio(sessionRecord) {
  const records = Array.isArray(sessionRecord.usageRecords) ? sessionRecord.usageRecords : [];
  if (records.length < 20) return [];

  const sorted = records.slice().sort((a, b) => compareTimestamps(a.timestamp, b.timestamp));

  const ratios = sorted.map((r) => (r.cacheCreationInputTokens || 0) / Math.max(r.cacheReadInputTokens || 0, 1));

  const quarterLen = Math.max(1, Math.floor(sorted.length / 4));
  const firstQuarter = ratios.slice(0, quarterLen);
  const lastQuarter = ratios.slice(ratios.length - quarterLen);

  const meanFirst = mean(firstQuarter);
  const meanLast = mean(lastQuarter);

  if (meanFirst <= 0) {
    // Avoid divide-by-zero; if there was literally no cache activity at the
    // start, treat any nonzero later ratio as a hard trigger only if it's
    // meaningfully large, otherwise skip (not enough signal).
    if (meanLast > 0) {
      return [
        {
          id: `cacheRatio:${sessionRecord.sessionId}`,
          sessionId: sessionRecord.sessionId,
          severity: 'info',
          message: `Cache reuse dropped significantly later in this session (cache writes are outpacing cache reads ${meanLast.toFixed(1)}x vs the session start). This usually means context is being rebuilt rather than reused — consider running /compact or starting a fresh session for the next task.`,
        },
      ];
    }
    return [];
  }

  const ratioOfRatios = meanLast / meanFirst;

  if (ratioOfRatios >= 2) {
    return [
      {
        id: `cacheRatio:${sessionRecord.sessionId}`,
        sessionId: sessionRecord.sessionId,
        severity: 'info',
        message: `Cache reuse dropped significantly later in this session (cache writes are outpacing cache reads ${ratioOfRatios.toFixed(1)}x vs the session start). This usually means context is being rebuilt rather than reused — consider running /compact or starting a fresh session for the next task.`,
      },
    ];
  }

  return [];
}

function mean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((sum, v) => sum + v, 0) / arr.length;
}

function compareTimestamps(a, b) {
  if (!a || !b) return 0;
  return a < b ? -1 : a > b ? 1 : 0;
}
