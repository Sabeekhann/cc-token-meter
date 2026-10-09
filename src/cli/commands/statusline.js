// Copyright 2026 FiveNodes
// SPDX-License-Identifier: Apache-2.0

import { discoverSessionFiles } from '../../ingest/discover.js';
import { parseSessionFile } from '../../ingest/parser.js';
import { localDateKey } from '../../ingest/aggregate.js';
import { readConfig } from '../../budget/config.js';
import { formatStatusline, summarizeUsageRecords } from '../../analytics/statusline.js';

const STDIN_TIMEOUT_MS = 1000;
const STDIN_MAX_BYTES = 256 * 1024;
// Bounds the work done on every statusline refresh. Days with more active
// transcripts than this report today's total as a lower bound ("+").
const MAX_TODAY_FILES = 20;
const SESSION_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Claude Code `statusLine` command: read the session JSON Claude Code sends
 * on stdin, then print one line of local usage for that session and today.
 *
 * Transcripts are only ever located through discoverSessionFiles(), so a
 * path supplied on stdin is never opened. Nothing is written: no index, no
 * config. Any failure prints a short neutral line and exits 0, because a
 * statusline that errors would replace useful UI with noise.
 */
export async function statuslineCommand({
  stdin = process.stdin,
  stdout = process.stdout,
  env = process.env,
  now = new Date(),
  discoverFiles = discoverSessionFiles,
  parseFile = parseSessionFile,
  loadConfig = readConfig,
} = {}) {
  try {
    const input = parseStatuslineInput(await readStdin(stdin));
    const line = await buildStatusline(input, { now, discoverFiles, parseFile, loadConfig, color: !env.NO_COLOR });
    stdout.write(`${line}\n`);
  } catch {
    stdout.write('◆ cc-token-meter: usage unavailable\n');
  }
}

export async function buildStatusline(input, { now, discoverFiles, parseFile, loadConfig, color }) {
  const files = await discoverFiles();
  const current = input.sessionId
    ? files.find((file) => file.sessionId === input.sessionId)
    : files.slice().sort((a, b) => b.mtimeMs - a.mtimeMs)[0];

  const todayKey = localDateKey(now.toISOString());
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const todayFiles = files
    .filter((file) => file.mtimeMs >= midnight.getTime())
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  const scanned = todayFiles.slice(0, MAX_TODAY_FILES);
  if (current && !scanned.some((file) => file.filePath === current.filePath)) scanned.push(current);

  const today = { tokenTotal: 0, costUsd: 0, estimated: false, partial: todayFiles.length > MAX_TODAY_FILES };
  let session = null;
  for (const file of scanned) {
    const { usageRecords } = await parseFile(file.filePath);
    const totals = summarizeUsageRecords(usageRecords, { todayKey });
    if (current && file.filePath === current.filePath) session = totals;
    today.tokenTotal += totals.today.tokenTotal;
    today.costUsd += totals.today.costUsd;
    today.estimated ||= totals.today.estimated;
  }

  return formatStatusline({ session, today, config: loadConfig(), model: input.model, color });
}

/**
 * Extract the fields the statusline uses from Claude Code's stdin JSON.
 * Unknown or malformed input yields empty values rather than an error.
 *
 * @param {string} raw
 * @returns {{sessionId: string|null, model: string|null}}
 */
export function parseStatuslineInput(raw) {
  let data = null;
  try {
    data = raw && raw.trim() ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }
  const sessionId = data && typeof data.session_id === 'string' && SESSION_ID_PATTERN.test(data.session_id)
    ? data.session_id
    : null;
  const model = data && data.model && typeof data.model.id === 'string' ? data.model.id : null;
  return { sessionId, model };
}

function readStdin(stdin) {
  if (!stdin || stdin.isTTY) return Promise.resolve('');
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stdin.removeListener('data', onData);
      stdin.removeListener('end', finish);
      stdin.removeListener('error', finish);
      if (typeof stdin.pause === 'function') stdin.pause();
      resolve(Buffer.concat(chunks).toString('utf8'));
    };
    const onData = (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      size += buffer.length;
      if (size > STDIN_MAX_BYTES) {
        chunks.length = 0;
        finish();
        return;
      }
      chunks.push(buffer);
    };
    const timer = setTimeout(finish, STDIN_TIMEOUT_MS);
    stdin.on('data', onData);
    stdin.once('end', finish);
    stdin.once('error', finish);
  });
}

export const STATUSLINE_CONFIG = `Show live Claude Code usage in Claude Code's status line.

1. Install the command globally (npx adds startup time to every refresh):

   npm install --global cc-token-meter

2. Add this to ~/.claude/settings.json (or a project's .claude/settings.json):

   {
     "statusLine": {
       "type": "command",
       "command": "cc-token-meter --statusline"
     }
   }

The line shows this session's estimated cost, tokens, cache reuse, and
context-window use, plus today's estimated cost (against your daily cap when
one is set). It reads local transcripts only and writes nothing. Set NO_COLOR=1
to disable colors. cc-token-meter never edits your Claude Code settings.`;

export async function statuslineConfigCommand({ stdout = process.stdout } = {}) {
  stdout.write(`${STATUSLINE_CONFIG}\n`);
}
