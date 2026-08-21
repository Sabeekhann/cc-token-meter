import { localDateKey } from '../ingest/aggregate.js';
import { computeCost } from '../pricing/cost.js';

/**
 * Normalize the filter object exposed by CLI JSON/CSV exports. Date strings
 * are inclusive local calendar dates (YYYY-MM-DD); project is a
 * case-insensitive substring match against the authoritative cwd/fallback.
 */
export function normalizeSummaryFilters(filters = {}) {
  return {
    from: filters.from || null,
    to: filters.to || null,
    project: filters.project ? String(filters.project).trim() || null : null,
  };
}

/**
 * Return a filtered, re-aggregated session snapshot without mutating the
 * store's canonical sessions. When a date range is active, every session
 * total is rebuilt from the exact per-message records inside that range.
 */
export function filterSessions(sessions, filters = {}) {
  const normalized = normalizeSummaryFilters(filters);
  const safeSessions = Array.isArray(sessions) ? sessions : [];
  const projectNeedle = normalized.project ? normalized.project.toLowerCase() : null;
  const hasDateFilter = Boolean(normalized.from || normalized.to);

  return safeSessions.flatMap((session) => {
    const project = session.projectCwd || session.projectDirNameFallback || 'unknown';
    if (projectNeedle && !project.toLowerCase().includes(projectNeedle)) return [];
    if (!hasDateFilter) return [session];

    const records = Array.isArray(session.usageRecords)
      ? session.usageRecords.filter((record) => dateMatches(record.timestamp, normalized))
      : [];
    if (records.length === 0) return [];

    return [rebuildSession(session, records, normalized)];
  });
}

function rebuildSession(session, records, filters) {
  const sortedRecords = records.slice().sort(compareRecordTimestamps);
  const totals = sortedRecords.reduce(
    (acc, record) => {
      acc.inputTokens += numberOr0(record.inputTokens);
      acc.outputTokens += numberOr0(record.outputTokens);
      acc.cacheCreationInputTokens += numberOr0(record.cacheCreationInputTokens);
      acc.cacheReadInputTokens += numberOr0(record.cacheReadInputTokens);
      acc.cacheWrite5m += numberOr0(record.cacheWrite5m);
      acc.cacheWrite1h += numberOr0(record.cacheWrite1h);
      const computed = Number.isFinite(record.costUsd) ? null : computeCost(record);
      acc.costUsd += computed ? computed.totalCost : record.costUsd;
      acc.estimatedCostUsed ||= record.estimatedCostUsed === true || computed?.estimated === true;
      return acc;
    },
    {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      cacheWrite5m: 0,
      cacheWrite1h: 0,
      costUsd: 0,
      estimatedCostUsed: false,
    },
  );

  const models = [...new Set(sortedRecords.map((record) => record.model).filter(Boolean))];
  const lastRecord = sortedRecords[sortedRecords.length - 1];
  const toolEvents = Array.isArray(session.toolEvents)
    ? session.toolEvents.filter((event) => dateMatches(event.timestamp, filters))
    : [];

  return {
    ...session,
    ...totals,
    models,
    messageCount: sortedRecords.length,
    firstTimestamp: sortedRecords[0].timestamp || null,
    lastTimestamp: lastRecord.timestamp || null,
    gitBranch: lastRecord.gitBranch || session.gitBranch || null,
    version: lastRecord.version || session.version || null,
    usageRecords: sortedRecords,
    toolEvents,
  };
}

function dateMatches(timestamp, { from, to }) {
  if (!timestamp) return false;
  const date = localDateKey(timestamp);
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

function compareRecordTimestamps(a, b) {
  const left = Date.parse(a.timestamp || '');
  const right = Date.parse(b.timestamp || '');
  if (!Number.isFinite(left) && !Number.isFinite(right)) return 0;
  if (!Number.isFinite(left)) return 1;
  if (!Number.isFinite(right)) return -1;
  return left - right;
}

function numberOr0(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
