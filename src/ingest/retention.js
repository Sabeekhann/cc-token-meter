import { localDateKey } from './aggregate.js';

export const RECENT_DETAIL_LIMIT = 1000;

const NUMERIC_FIELDS = [
  'messageCount',
  'inputTokens',
  'outputTokens',
  'cacheCreationInputTokens',
  'cacheReadInputTokens',
  'cacheWrite5m',
  'cacheWrite1h',
  'costUsd',
  'missingTimestampCount',
  'missingBranchCount',
  'estimatedCostMessageCount',
];

/**
 * Keep a bounded recent per-message window while preserving exact historical
 * totals in deterministic daily/model/branch rollups. This function is pure
 * so migrations and tests can apply the same retention policy as the store.
 */
export function compactSessionHistory(session, options = {}) {
  const detailLimit = normalizeDetailLimit(options.detailLimit);
  const records = Array.isArray(session.usageRecords) ? session.usageRecords : [];
  const overflowCount = Math.max(0, records.length - detailLimit);
  const rollups = new Map();

  for (const existing of Array.isArray(session.dailyRollups) ? session.dailyRollups : []) {
    mergeAggregate(rollups, normalizeRollup(existing));
  }

  for (const record of records.slice(0, overflowCount)) {
    mergeAggregate(rollups, rollupForRecord(record, session));
  }

  return {
    ...session,
    dailyRollups: Array.from(rollups.values()).sort(compareRollups),
    usageRecords: records.slice(overflowCount),
  };
}

export function retainedMessageCount(session) {
  const detailCount = Array.isArray(session.usageRecords) ? session.usageRecords.length : 0;
  const rolledCount = (Array.isArray(session.dailyRollups) ? session.dailyRollups : [])
    .reduce((sum, rollup) => sum + numberOr0(rollup.messageCount), 0);
  return detailCount + rolledCount;
}

function rollupForRecord(record, session) {
  const timestamp = validTimestamp(record.timestamp) ? record.timestamp : null;
  return {
    date: timestamp ? localDateKey(timestamp) : null,
    gitBranch: record.gitBranch || null,
    model: record.model || null,
    version: record.version || session.version || null,
    firstTimestamp: timestamp,
    lastTimestamp: timestamp,
    messageCount: 1,
    inputTokens: numberOr0(record.inputTokens),
    outputTokens: numberOr0(record.outputTokens),
    cacheCreationInputTokens: numberOr0(record.cacheCreationInputTokens),
    cacheReadInputTokens: numberOr0(record.cacheReadInputTokens),
    cacheWrite5m: numberOr0(record.cacheWrite5m),
    cacheWrite1h: numberOr0(record.cacheWrite1h),
    costUsd: numberOr0(record.costUsd),
    estimatedCostUsed: record.estimatedCostUsed === true,
    missingTimestampCount: timestamp ? 0 : 1,
    missingBranchCount: record.gitBranch ? 0 : 1,
    estimatedCostMessageCount: record.estimatedCostUsed === true ? 1 : 0,
  };
}

function normalizeRollup(rollup) {
  const normalized = {
    date: typeof rollup.date === 'string' && rollup.date ? rollup.date : null,
    gitBranch: rollup.gitBranch || null,
    model: rollup.model || null,
    version: rollup.version || null,
    firstTimestamp: validTimestamp(rollup.firstTimestamp) ? rollup.firstTimestamp : null,
    lastTimestamp: validTimestamp(rollup.lastTimestamp) ? rollup.lastTimestamp : null,
    estimatedCostUsed: rollup.estimatedCostUsed === true,
  };
  for (const field of NUMERIC_FIELDS) normalized[field] = numberOr0(rollup[field]);
  return normalized;
}

function mergeAggregate(rollups, incoming) {
  const key = JSON.stringify([
    incoming.date,
    incoming.gitBranch,
    incoming.model,
    incoming.version,
  ]);
  let target = rollups.get(key);
  if (!target) {
    target = {
      ...incoming,
      ...Object.fromEntries(NUMERIC_FIELDS.map((field) => [field, 0])),
      estimatedCostUsed: false,
    };
    rollups.set(key, target);
  }

  for (const field of NUMERIC_FIELDS) target[field] += numberOr0(incoming[field]);
  target.estimatedCostUsed ||= incoming.estimatedCostUsed === true;
  target.firstTimestamp = earlierTimestamp(target.firstTimestamp, incoming.firstTimestamp);
  target.lastTimestamp = laterTimestamp(target.lastTimestamp, incoming.lastTimestamp);
}

function compareRollups(left, right) {
  return JSON.stringify([left.date, left.gitBranch, left.model, left.version])
    .localeCompare(JSON.stringify([right.date, right.gitBranch, right.model, right.version]));
}

function normalizeDetailLimit(value) {
  return Number.isInteger(value) && value >= 0 ? value : RECENT_DETAIL_LIMIT;
}

function earlierTimestamp(left, right) {
  if (!left) return right || null;
  if (!right) return left;
  return Date.parse(left) <= Date.parse(right) ? left : right;
}

function laterTimestamp(left, right) {
  if (!left) return right || null;
  if (!right) return left;
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

function validTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function numberOr0(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
