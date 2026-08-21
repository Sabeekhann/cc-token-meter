import fs from 'node:fs';
import path from 'node:path';
import { createStore } from '../../ingest/store.js';
import { buildSummary } from '../../server/summary.js';

const GROUPS = new Set(['day', 'project', 'branch', 'session']);

export async function csvCommand({
  cache = true,
  outputPath,
  groupBy = 'day',
  filters = {},
} = {}) {
  if (!outputPath) throw new Error('--csv requires a destination path or `-` for stdout');
  if (!GROUPS.has(groupBy)) {
    throw new Error(`--group-by must be one of: ${[...GROUPS].join(', ')}`);
  }

  const store = createStore({ persistIndex: cache });
  await store.ingestNewData();
  const summary = buildSummary(store, { filters });
  const csv = buildCsv(summary, groupBy);

  if (outputPath === '-') {
    process.stdout.write(csv);
    return;
  }

  writePrivateFile(outputPath, csv);
  console.log(`Wrote ${groupBy} usage export to ${path.resolve(outputPath)}`);
}

export function buildCsv(summary, groupBy = 'day') {
  if (!GROUPS.has(groupBy)) throw new Error(`Unsupported CSV group: ${groupBy}`);

  const { headers, rows } = csvShape(summary || {}, groupBy);
  return [headers, ...rows]
    .map((row) => row.map(csvCell).join(','))
    .join('\n') + '\n';
}

function csvShape(summary, groupBy) {
  if (groupBy === 'project') {
    return {
      headers: metricHeaders('project', 'sessionCount'),
      rows: (summary.byProject || []).map((item) => metricRow(item.project, item, item.sessions?.length || 0)),
    };
  }

  if (groupBy === 'branch') {
    return {
      headers: metricHeaders('branch', 'sessionCount'),
      rows: (summary.byBranch || []).map((item) => metricRow(item.branch, item, item.sessions?.length || 0)),
    };
  }

  if (groupBy === 'session') {
    return {
      headers: [
        'sessionId',
        'project',
        'gitBranch',
        'models',
        'firstTimestamp',
        'lastTimestamp',
        'messageCount',
        'inputTokens',
        'outputTokens',
        'cacheCreationInputTokens',
        'cacheReadInputTokens',
        'tokenTotal',
        'costUsd',
        'estimatedCostUsed',
      ],
      rows: (summary.sessions || []).map((session) => [
        session.sessionId,
        session.project,
        session.gitBranch || '',
        (session.models || []).join('|'),
        session.firstTimestamp || '',
        session.lastTimestamp || '',
        numberOr0(session.messageCount),
        numberOr0(session.inputTokens),
        numberOr0(session.outputTokens),
        numberOr0(session.cacheCreationInputTokens),
        numberOr0(session.cacheReadInputTokens),
        numberOr0(session.tokenTotal),
        fixedCost(session.costUsd),
        session.estimatedCostUsed === true,
      ]),
    };
  }

  return {
    headers: metricHeaders('date', 'messageCount'),
    rows: (summary.byDay || []).map((item) => metricRow(item.date, item, item.messageCount || 0)),
  };
}

function metricHeaders(groupHeader, countHeader) {
  return [
    groupHeader,
    countHeader,
    'inputTokens',
    'outputTokens',
    'cacheCreationInputTokens',
    'cacheReadInputTokens',
    'tokenTotal',
    'costUsd',
  ];
}

function metricRow(label, item, count) {
  return [
    label,
    count,
    numberOr0(item.inputTokens),
    numberOr0(item.outputTokens),
    numberOr0(item.cacheCreationInputTokens),
    numberOr0(item.cacheReadInputTokens),
    numberOr0(item.tokenTotal),
    fixedCost(item.costUsd),
  ];
}

function csvCell(value) {
  const string = value == null ? '' : String(value);
  if (!/[",\r\n]/.test(string)) return string;
  return `"${string.replace(/"/g, '""')}"`;
}

function fixedCost(value) {
  return numberOr0(value).toFixed(6);
}

function numberOr0(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function writePrivateFile(filePath, contents) {
  const resolved = path.resolve(filePath);
  const directory = path.dirname(resolved);
  if (!fs.existsSync(directory)) {
    throw new Error(`Export directory does not exist: ${directory}`);
  }

  const temporary = `${resolved}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporary, contents, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, resolved);
    try {
      fs.chmodSync(resolved, 0o600);
    } catch {
      // Best effort on Windows and filesystems without POSIX permissions.
    }
  } finally {
    try {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    } catch {
      // Cleanup failure must not hide the original export error.
    }
  }
}

export { GROUPS };
