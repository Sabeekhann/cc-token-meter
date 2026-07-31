import { sessionInputRatePerToken } from './_pricingHelper.js';
import { CACHE_READ_MULTIPLIER } from '../pricing/models.js';

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

  const lastQuarterRecords = sorted.slice(sorted.length - quarterLen);

  if (meanFirst <= 0) {
    // Avoid divide-by-zero; if there was literally no cache activity at the
    // start, treat any nonzero later ratio as a hard trigger only if it's
    // meaningfully large, otherwise skip (not enough signal).
    if (meanLast > 0) {
      const { estimatedSavingsTokens, estimatedSavingsUsd } = estimateCacheSavings(
        lastQuarterRecords,
        sessionRecord
      );
      return [
        {
          id: `cacheRatio:${sessionRecord.sessionId}`,
          sessionId: sessionRecord.sessionId,
          severity: 'info',
          message: `Cache reuse dropped significantly later in this session (cache writes are outpacing cache reads ${meanLast.toFixed(1)}x vs the session start). This usually means context is being rebuilt rather than reused — consider running /compact or starting a fresh session for the next task.${savingsClause(estimatedSavingsTokens, estimatedSavingsUsd)}`,
          estimatedSavingsTokens,
          estimatedSavingsUsd,
        },
      ];
    }
    return [];
  }

  const ratioOfRatios = meanLast / meanFirst;

  if (ratioOfRatios >= 2) {
    const { estimatedSavingsTokens, estimatedSavingsUsd } = estimateCacheSavings(
      lastQuarterRecords,
      sessionRecord
    );
    return [
      {
        id: `cacheRatio:${sessionRecord.sessionId}`,
        sessionId: sessionRecord.sessionId,
        severity: 'info',
        message: `Cache reuse dropped significantly later in this session (cache writes are outpacing cache reads ${ratioOfRatios.toFixed(1)}x vs the session start). This usually means context is being rebuilt rather than reused — consider running /compact or starting a fresh session for the next task.${savingsClause(estimatedSavingsTokens, estimatedSavingsUsd)}`,
        estimatedSavingsTokens,
        estimatedSavingsUsd,
      },
    ];
  }

  return [];
}

/**
 * Estimate the $/token saveable if the last-quarter cache-write tokens had
 * instead hit cache reads. `cacheCreationInputTokens` in the degraded
 * (last-quarter) window is the token volume that plausibly could've been
 * cache reads instead, priced at the delta between the full input rate and
 * the (much cheaper) cache-read rate — that delta is what's actually
 * saveable per token if it had hit cache instead of being rewritten.
 */
function estimateCacheSavings(lastQuarterRecords, sessionRecord) {
  const tokens = lastQuarterRecords.reduce((sum, r) => sum + (r.cacheCreationInputTokens || 0), 0);
  if (tokens <= 0) return { estimatedSavingsTokens: null, estimatedSavingsUsd: null };

  const fullRate = sessionInputRatePerToken(sessionRecord);
  const cacheReadRate = fullRate * CACHE_READ_MULTIPLIER;
  const deltaRate = fullRate - cacheReadRate;

  return {
    estimatedSavingsTokens: Math.round(tokens),
    estimatedSavingsUsd: tokens * deltaRate,
  };
}

function savingsClause(estimatedSavingsTokens, estimatedSavingsUsd) {
  if (estimatedSavingsTokens == null || estimatedSavingsUsd == null) return '';
  return ` That's roughly ${estimatedSavingsTokens.toLocaleString()} tokens (~$${estimatedSavingsUsd.toFixed(2)}) that could've been cheap cache reads instead of full-price cache rebuilds.`;
}

function mean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((sum, v) => sum + v, 0) / arr.length;
}

function compareTimestamps(a, b) {
  if (!a || !b) return 0;
  return a < b ? -1 : a > b ? 1 : 0;
}
