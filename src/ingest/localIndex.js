import fs from 'node:fs';
import path from 'node:path';
import { resolveStateDirectory } from '../paths.js';

// v3 bounds per-message history and moves older exact counters into daily
// rollups.
export const LOCAL_INDEX_VERSION = 3;
// Bumped whenever ingestion starts counting differently. An index written
// under an older revision holds totals the current parser would not produce
// (revision 2: one usage per API response instead of per content-block line,
// plus subagent transcripts), so it is rebuilt from transcripts once rather
// than restored or migrated.
export const ACCOUNTING_REVISION = 2;
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
 * Read a current index. Indexes from an older accounting revision, including
 * every v2 index, are treated as absent so the caller rebuilds them from the
 * read-only transcripts instead of carrying old totals forward.
 */
export function readLocalIndexWithStatus(filePath = DEFAULT_INDEX_FILE) {
  const primary = readIndexCandidate(filePath);
  if (primary.exists) return normalizeCandidate(primary.value, filePath);
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
  if (isValidIndex(value, LOCAL_INDEX_VERSION) && value.accountingRevision === ACCOUNTING_REVISION) {
    return { index: value, migrated: false, sourcePath };
  }
  return null;
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
    accountingRevision: ACCOUNTING_REVISION,
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
