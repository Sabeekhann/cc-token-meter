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

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

/**
 * Read the budget config from ~/.claude-token-meter/config.json, creating
 * the directory (and returning defaults) if it doesn't exist yet. Never
 * throws for a missing file — only for genuinely malformed JSON, in which
 * case we fall back to defaults rather than crashing the CLI/server.
 *
 * @returns {{dailyTokenCap: number|null, dailyCostCapUsd: number|null, sessionTokenCap: number|null, sessionCostCapUsd: number|null, warnThresholdPct: number}}
 */
export function readConfig() {
  ensureConfigDir();
  if (!fs.existsSync(CONFIG_FILE)) {
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
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
export function writeConfig(updates) {
  ensureConfigDir();
  const current = readConfig();
  const next = { ...current, ...updates };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

export { CONFIG_DIR, CONFIG_FILE, DEFAULT_CONFIG };
