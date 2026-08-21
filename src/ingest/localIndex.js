import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// v2 adds exact per-message cost, fallback-pricing, and branch attribution.
// A v1 index is intentionally ignored and rebuilt from read-only transcripts
// so filtered/day/branch exports cannot inherit old session-level estimates.
export const LOCAL_INDEX_VERSION = 2;
export const DEFAULT_INDEX_FILE = path.join(
  os.homedir(),
  '.claude-token-meter',
  `usage-index-v${LOCAL_INDEX_VERSION}.json`
);

/**
 * Read and minimally validate the private local usage index. Corrupt,
 * missing, or future-version indexes are ignored so the caller can safely
 * rebuild from the read-only Claude Code transcripts.
 *
 * @param {string} [filePath]
 * @returns {object|null}
 */
export function readLocalIndex(filePath = DEFAULT_INDEX_FILE) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!isValidIndex(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
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

function isValidIndex(value) {
  return (
    value &&
    typeof value === 'object' &&
    value.version === LOCAL_INDEX_VERSION &&
    Array.isArray(value.sessions) &&
    Array.isArray(value.files) &&
    typeof value.totalIngestedMessages === 'number'
  );
}
