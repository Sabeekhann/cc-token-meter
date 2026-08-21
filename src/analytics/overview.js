import { computeCost, matchModelRow } from '../pricing/cost.js';
import { CACHE_READ_MULTIPLIER } from '../pricing/models.js';

const DEFAULT_ACTIVE_WINDOW_MINUTES = 10;
const DEFAULT_VELOCITY_WINDOW_MINUTES = 15;

/**
 * Build the small, decision-oriented analytics block used by the v2
 * dashboard. This module is intentionally pure: it accepts a session
 * snapshot and a clock value, and performs no file or network I/O.
 *
 * @param {Array<object>} sessions
 * @param {{now?: string|number|Date, activeWindowMinutes?: number, velocityWindowMinutes?: number}} [options]
 * @returns {object}
 */
export function buildUsageIntelligence(sessions, options = {}) {
  const safeSessions = Array.isArray(sessions) ? sessions : [];
  const nowMs = toTimestamp(options.now ?? Date.now());
  const activeWindowMinutes = positiveNumber(
    options.activeWindowMinutes,
    DEFAULT_ACTIVE_WINDOW_MINUTES
  );
  const velocityWindowMinutes = positiveNumber(
    options.velocityWindowMinutes,
    DEFAULT_VELOCITY_WINDOW_MINUTES
  );

  const records = flattenRecords(safeSessions);

  return {
    active: buildActiveSummary(safeSessions, nowMs, activeWindowMinutes),
    velocity: buildVelocity(records, nowMs, velocityWindowMinutes),
    cache: buildCacheHealth(records),
    models: buildModelMix(records),
    dataQuality: buildDataQuality(records),
  };
}

function flattenRecords(sessions) {
  const records = [];
  for (const session of sessions) {
    const usageRecords = Array.isArray(session.usageRecords) ? session.usageRecords : [];
    for (const record of usageRecords) {
      records.push({
        ...record,
        sessionId: record.sessionId || session.sessionId || null,
        project: record.projectCwd || session.projectCwd || session.projectDirNameFallback || 'unknown',
        gitBranch: record.gitBranch || session.gitBranch || null,
      });
    }
  }
  return records;
}

function buildActiveSummary(sessions, nowMs, windowMinutes) {
  const cutoff = nowMs - windowMinutes * 60_000;
  const active = sessions
    .filter((session) => {
      const timestamp = toTimestamp(session.lastTimestamp);
      return Number.isFinite(timestamp) && timestamp >= cutoff && timestamp <= nowMs;
    })
    .sort((a, b) => toTimestamp(b.lastTimestamp) - toTimestamp(a.lastTimestamp));

  const latest = active[0] || null;
  return {
    windowMinutes,
    sessionCount: active.length,
    latestSessionId: latest ? latest.sessionId : null,
    latestProject: latest
      ? latest.projectCwd || latest.projectDirNameFallback || 'unknown'
      : null,
    latestBranch: latest ? latest.gitBranch || null : null,
    latestTimestamp: latest ? latest.lastTimestamp || null : null,
  };
}

function buildVelocity(records, nowMs, windowMinutes) {
  const cutoff = nowMs - windowMinutes * 60_000;
  const recent = records.filter((record) => {
    const timestamp = toTimestamp(record.timestamp);
    return Number.isFinite(timestamp) && timestamp >= cutoff && timestamp <= nowMs;
  });

  const totals = recent.reduce(
    (acc, record) => {
      acc.messageCount += 1;
      acc.tokenTotal += tokenTotal(record);
      acc.costUsd += recordCost(record).totalCost;
      return acc;
    },
    { messageCount: 0, tokenTotal: 0, costUsd: 0 }
  );

  return {
    windowMinutes,
    ...totals,
    tokensPerMinute: totals.tokenTotal / windowMinutes,
    costPerHour: totals.costUsd * (60 / windowMinutes),
  };
}

function buildCacheHealth(records) {
  let freshInputTokens = 0;
  let cacheCreationTokens = 0;
  let cacheReadTokens = 0;
  let estimatedSavingsUsd = 0;

  for (const record of records) {
    freshInputTokens += numOr0(record.inputTokens);
    cacheCreationTokens += numOr0(record.cacheCreationInputTokens);
    cacheReadTokens += numOr0(record.cacheReadInputTokens);

    const { row } = matchModelRow(record.model, record.timestamp);
    const fullInputRate = row.inputPerMTok / 1_000_000;
    estimatedSavingsUsd +=
      numOr0(record.cacheReadInputTokens) * fullInputRate * (1 - CACHE_READ_MULTIPLIER);
  }

  const cacheEligibleTokens = freshInputTokens + cacheCreationTokens + cacheReadTokens;
  const reuseRate = cacheEligibleTokens > 0 ? cacheReadTokens / cacheEligibleTokens : 0;

  return {
    freshInputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    cacheEligibleTokens,
    reuseRate,
    estimatedSavingsUsd,
  };
}

function buildModelMix(records) {
  const byModel = new Map();

  for (const record of records) {
    const model = record.model || 'unknown';
    let bucket = byModel.get(model);
    if (!bucket) {
      bucket = {
        model,
        messageCount: 0,
        tokenTotal: 0,
        costUsd: 0,
        estimatedCostUsed: false,
      };
      byModel.set(model, bucket);
    }

    const cost = recordCost(record);
    bucket.messageCount += 1;
    bucket.tokenTotal += tokenTotal(record);
    bucket.costUsd += cost.totalCost;
    bucket.estimatedCostUsed ||= cost.estimated;
  }

  return Array.from(byModel.values()).sort((a, b) => b.costUsd - a.costUsd);
}

function buildDataQuality(records) {
  let missingTimestampCount = 0;
  let missingBranchCount = 0;
  let estimatedCostMessageCount = 0;

  for (const record of records) {
    if (!Number.isFinite(toTimestamp(record.timestamp))) missingTimestampCount += 1;
    if (!record.gitBranch) missingBranchCount += 1;
    if (recordCost(record).estimated) estimatedCostMessageCount += 1;
  }

  return {
    messageCount: records.length,
    missingTimestampCount,
    missingBranchCount,
    estimatedCostMessageCount,
    exactCostMessageCount: records.length - estimatedCostMessageCount,
  };
}

function recordCost(record) {
  if (Number.isFinite(record.costUsd)) {
    return {
      totalCost: record.costUsd,
      estimated: record.estimatedCostUsed === true,
    };
  }
  const computed = computeCost(record);
  return { totalCost: computed.totalCost, estimated: computed.estimated };
}

function tokenTotal(record) {
  return (
    numOr0(record.inputTokens) +
    numOr0(record.outputTokens) +
    numOr0(record.cacheCreationInputTokens) +
    numOr0(record.cacheReadInputTokens)
  );
}

function numOr0(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function positiveNumber(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function toTimestamp(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (typeof value === 'string' && value) return Date.parse(value);
  return NaN;
}
