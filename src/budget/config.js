import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CONFIG_DIR = path.join(os.homedir(), '.claude-token-meter');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG = {
  dailyTokenCap: null,
  dailyCostCapUsd: null,
  sessionTokenCap: null,
  sessionCostCapUsd: null,
  warnThresholdPct: 80,
};

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
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Merge `updates` into the existing config and persist to disk.
 *
 * @param {Partial<typeof DEFAULT_CONFIG>} updates
 * @returns {typeof DEFAULT_CONFIG} the full config after merging
 */
export function writeConfig(updates, filePath = CONFIG_FILE) {
  ensureConfigDir(path.dirname(filePath));
  const current = readConfig(filePath);
  const next = { ...current, ...updates };
  fs.writeFileSync(filePath, JSON.stringify(next, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Best effort on filesystems/platforms without POSIX permissions.
  }
  return next;
}

export { CONFIG_DIR, CONFIG_FILE, DEFAULT_CONFIG };
