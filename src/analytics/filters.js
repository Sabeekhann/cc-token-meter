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
 * total is rebuilt from exact daily rollups plus recent per-message records
 * inside that range.
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
    const rollups = Array.isArray(session.dailyRollups)
      ? session.dailyRollups.filter((rollup) => dateKeyMatches(rollup.date, normalized))
      : [];
    if (records.length === 0 && rollups.length === 0) return [];

    return [rebuildSession(session, records, rollups, normalized)];
  });
}

function rebuildSession(session, records, rollups, filters) {
  const sortedRecords = records.slice().sort(compareRecordTimestamps);
  const sortedRollups = rollups.slice().sort(compareRollupTimestamps);
  const units = [...sortedRollups, ...sortedRecords];
  const totals = units.reduce(
    (acc, record) => {
      acc.messageCount += Number.isFinite(record.messageCount) ? record.messageCount : 1;
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
      messageCount: 0,
    },
  );

  const models = [...new Set(units.map((record) => record.model).filter(Boolean))];
  const timestampedUnits = units
    .map((unit) => ({
      ...unit,
      firstTimestamp: unit.firstTimestamp || unit.timestamp || null,
      lastTimestamp: unit.lastTimestamp || unit.timestamp || null,
    }))
    .filter((unit) => unit.firstTimestamp || unit.lastTimestamp)
    .sort(compareRollupTimestamps);
  const firstTimestamp = timestampedUnits.reduce((earliest, unit) => {
    if (!unit.firstTimestamp) return earliest;
    if (!earliest || Date.parse(unit.firstTimestamp) < Date.parse(earliest)) {
      return unit.firstTimestamp;
    }
    return earliest;
  }, null);
  const lastUnit = timestampedUnits[timestampedUnits.length - 1] || null;
  const toolEvents = Array.isArray(session.toolEvents)
    ? session.toolEvents.filter((event) => dateMatches(event.timestamp, filters))
    : [];

  return {
    ...session,
    ...totals,
    models,
    firstTimestamp,
    lastTimestamp: lastUnit?.lastTimestamp || null,
    gitBranch: lastUnit?.gitBranch || session.gitBranch || null,
    version: lastUnit?.version || session.version || null,
    dailyRollups: sortedRollups,
    usageRecords: sortedRecords,
    toolEvents,
  };
}

function dateMatches(timestamp, { from, to }) {
  if (!timestamp) return false;
  const date = localDateKey(timestamp);
  if (!date) return false;
  return dateKeyMatches(date, { from, to });
}

function dateKeyMatches(date, { from, to }) {
  if (!date) return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

function compareRollupTimestamps(a, b) {
  const left = Date.parse(a.lastTimestamp || a.firstTimestamp || a.timestamp || '');
  const right = Date.parse(b.lastTimestamp || b.firstTimestamp || b.timestamp || '');
  if (!Number.isFinite(left) && !Number.isFinite(right)) return 0;
  if (!Number.isFinite(left)) return 1;
  if (!Number.isFinite(right)) return -1;
  return left - right;
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
