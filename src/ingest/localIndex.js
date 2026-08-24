import fs from 'node:fs';
import path from 'node:path';
import { resolveStateDirectory } from '../paths.js';
import { compactSessionHistory } from './retention.js';

// v3 bounds per-message history and moves older exact counters into daily
// rollups. v2 remains readable for a one-way, automatic local migration.
export const LOCAL_INDEX_VERSION = 3;
const MIGRATABLE_INDEX_VERSION = 2;
export function defaultIndexFile(home) {
  return path.join(resolveStateDirectory(home), `usage-index-v${LOCAL_INDEX_VERSION}.json`);
}

export const DEFAULT_INDEX_FILE = defaultIndexFile();

/**
 * Read and minimally validate the private local usage index. Corrupt,
 * missing, or future-version indexes are ignored so the caller can safely
 * rebuild from the read-only Claude Code transcripts.
 *
 * @param {string} [filePath]
 * @returns {object|null}
 */
export function readLocalIndex(filePath = DEFAULT_INDEX_FILE) {
  return readLocalIndexWithStatus(filePath)?.index || null;
}

/**
 * Read a current index, or migrate the previous v2 shape in memory. When the
 * default v3 path does not exist, the sibling v2 path is checked so an upgrade
 * remains warm and the caller can atomically write the migrated v3 index.
 */
export function readLocalIndexWithStatus(filePath = DEFAULT_INDEX_FILE) {
  const primary = readIndexCandidate(filePath);
  if (primary.exists) return normalizeCandidate(primary.value, filePath);

  if (path.basename(filePath) === `usage-index-v${LOCAL_INDEX_VERSION}.json`) {
    const previousPath = path.join(
      path.dirname(filePath),
      `usage-index-v${MIGRATABLE_INDEX_VERSION}.json`,
    );
    const previous = readIndexCandidate(previousPath);
    if (previous.exists) return normalizeCandidate(previous.value, previousPath);
  }

  return null;
}

function readIndexCandidate(filePath) {
  try {
    return { exists: true, value: JSON.parse(fs.readFileSync(filePath, 'utf8')) };
  } catch (error) {
    return { exists: error && error.code !== 'ENOENT', value: null };
  }
}

function normalizeCandidate(value, sourcePath) {
  if (isValidIndex(value, LOCAL_INDEX_VERSION)) {
    return { index: value, migrated: false, sourcePath };
  }
  if (isValidIndex(value, MIGRATABLE_INDEX_VERSION)) {
    return { index: migrateV2Index(value), migrated: true, sourcePath };
  }
  return null;
}

export function migrateV2Index(index) {
  const sessions = index.sessions.map((session) => compactSessionHistory({
    ...session,
    dailyRollups: [],
    usageRecords: Array.isArray(session.usageRecords) ? session.usageRecords : [],
  }));

  return {
    ...index,
    version: LOCAL_INDEX_VERSION,
    sessions,
    totalIngestedMessages: sessions.reduce(
      (sum, session) => sum + numberOr0(session.messageCount),
      0,
    ),
  };
}

/**
 * Atomically write the local usage index with owner-only permissions.
 * The index contains normalized counters and local paths, never prompt or
 * tool-result content.
 *
 * @param {object} index
 * @param {string} [filePath]
 */
export function writeLocalIndex(index, filePath = DEFAULT_INDEX_FILE) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    // Best effort on filesystems/platforms without POSIX permissions.
  }

  const payload = {
    ...index,
    version: LOCAL_INDEX_VERSION,
    writtenAt: new Date().toISOString(),
  };
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

  try {
    fs.writeFileSync(tempPath, JSON.stringify(payload), {
      encoding: 'utf8',
      mode: 0o600,
    });
    fs.renameSync(tempPath, filePath);
    try {
      fs.chmodSync(filePath, 0o600);
    } catch {
      // Best effort on filesystems/platforms without POSIX permissions.
    }
  } finally {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {
      // A failed cleanup must not mask the original write error.
    }
  }
}

function isValidIndex(value, version) {
  return (
    value &&
    typeof value === 'object' &&
    value.version === version &&
    Array.isArray(value.sessions) &&
    Array.isArray(value.files) &&
    typeof value.totalIngestedMessages === 'number'
  );
}

function numberOr0(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
