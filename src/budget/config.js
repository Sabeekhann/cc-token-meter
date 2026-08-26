import fs from 'node:fs';
import path from 'node:path';
import { resolveStateDirectory } from '../paths.js';

const CONFIG_DIR = resolveStateDirectory();
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG = {
  dailyTokenCap: null,
  dailyCostCapUsd: null,
  sessionTokenCap: null,
  sessionCostCapUsd: null,
  warnThresholdPct: 80,
};

const CAP_KEYS = new Set([
  'dailyTokenCap',
  'dailyCostCapUsd',
  'sessionTokenCap',
  'sessionCostCapUsd',
]);

function ensureConfigDir(directory = CONFIG_DIR) {
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  try {
    fs.chmodSync(directory, 0o700);
  } catch {
    // Best effort on filesystems/platforms without POSIX permissions.
  }
}

/**
 * Read the budget config from ~/.claude-token-meter/config.json. Reading is
 * side-effect free: a fresh install does not create local state until the
 * user actually saves a budget or the usage index is persisted. Missing or
 * malformed files return defaults rather than crashing the CLI/server.
 * Invalid individual values are replaced by their safe defaults.
 *
 * @returns {{dailyTokenCap: number|null, dailyCostCapUsd: number|null, sessionTokenCap: number|null, sessionCostCapUsd: number|null, warnThresholdPct: number}}
 */
export function readConfig(filePath = CONFIG_FILE) {
  if (!fs.existsSync(filePath)) {
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ...DEFAULT_CONFIG };
    }
    return sanitizeStoredConfig(parsed);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Merge validated updates into the existing config and persist atomically.
 * Invalid values are rejected instead of being written and interpreted later.
 *
 * @param {Partial<typeof DEFAULT_CONFIG>} updates
 * @returns {typeof DEFAULT_CONFIG} the full config after merging
 */
export function writeConfig(updates, filePath = CONFIG_FILE) {
  const validated = validateConfigUpdates(updates);
  ensureConfigDir(path.dirname(filePath));
  const current = readConfig(filePath);
  const next = { ...current, ...validated };
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;

  try {
    fs.writeFileSync(temporary, JSON.stringify(next, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
    fs.renameSync(temporary, filePath);
    try {
      fs.chmodSync(filePath, 0o600);
    } catch {
      // Best effort on filesystems/platforms without POSIX permissions.
    }
  } finally {
    try {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    } catch {
      // Cleanup failure must not hide the original config-write error.
    }
  }

  return next;
}

export function validateConfigUpdates(updates) {
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    throw new TypeError('budget config updates must be an object');
  }

  const validated = {};
  for (const [key, value] of Object.entries(updates)) {
    if (CAP_KEYS.has(key)) {
      if (value !== null && (!Number.isFinite(value) || value < 0)) {
        throw new RangeError(`${key} must be null or a non-negative finite number`);
      }
      validated[key] = value;
      continue;
    }

    if (key === 'warnThresholdPct') {
      if (!Number.isFinite(value) || value < 1 || value > 100) {
        throw new RangeError('warnThresholdPct must be a finite number from 1 to 100');
      }
      validated[key] = value;
      continue;
    }

    throw new Error(`unsupported budget config key: ${key}`);
  }

  return validated;
}

function sanitizeStoredConfig(parsed) {
  const next = { ...DEFAULT_CONFIG };

  for (const key of CAP_KEYS) {
    const value = parsed[key];
    if (value === null || (Number.isFinite(value) && value >= 0)) next[key] = value;
  }

  if (
    Number.isFinite(parsed.warnThresholdPct) &&
    parsed.warnThresholdPct >= 1 &&
    parsed.warnThresholdPct <= 100
  ) {
    next.warnThresholdPct = parsed.warnThresholdPct;
  }

  return next;
}

export { CONFIG_DIR, CONFIG_FILE, DEFAULT_CONFIG };
