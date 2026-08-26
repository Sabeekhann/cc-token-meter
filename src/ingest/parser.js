import fs from 'node:fs';
import { isCompactEvent } from './compact.js';

const TOOL_NAMES_WITH_FILE_PATH = new Set(['Read', 'Edit', 'Write', 'MultiEdit']);

/**
 * Stream-parse a single JSONL session transcript file starting at a given
 * byte offset. Never reads the whole file into memory — uses a readline
 * interface over a createReadStream({ start: byteOffset }).
 *
 * Malformed non-trailing lines are skipped (JSON.parse errors caught,
 * logged nowhere, just skipped, loop continues). Unknown `type` values are
 * silently skipped (open/non-exhaustive set).
 *
 * The trailing line may be a half-written JSON object if the file is being
 * actively appended to by a live session — detected via JSON.parse failure
 * specifically on the LAST line read. In that case we do not advance the
 * offset past it, so it will be re-read (complete) on the next poll cycle.
 *
 * @param {string} filePath
 * @param {{startOffset?: number}} [opts]
 * @returns {Promise<{
 *   usageRecords: Array<object>,
 *   toolUseEvents: Array<object>,
 *   toolResultEvents: Array<object>,
 *   compactDetected: boolean,
 *   compactDetectionComplete: boolean,
 *   newOffset: number,
 * }>}
 */
export async function parseSessionFile(filePath, { startOffset = 0 } = {}) {
  const usageRecords = [];
  const toolUseEvents = [];
  const toolResultEvents = [];
  const compactEvents = { detected: false };

  // If the file shrank below the requested offset (e.g. truncated/rotated),
  // fall back to reading from the start to avoid an invalid stream range.
  let effectiveStartOffset = startOffset;
  try {
    const stat = fs.statSync(filePath);
    if (startOffset > stat.size) {
      effectiveStartOffset = 0;
    }
  } catch {
    // File may have disappeared; return an empty result at the same offset.
    return {
      usageRecords,
      toolUseEvents,
      toolResultEvents,
      compactDetected: false,
      compactDetectionComplete: false,
      newOffset: startOffset,
    };
  }

  const stream = fs.createReadStream(filePath, { start: effectiveStartOffset });
  let offset = effectiveStartOffset;
  let pending = Buffer.alloc(0);
  const events = { usageRecords, toolUseEvents, toolResultEvents, compactEvents };

  // Split the raw byte stream ourselves instead of relying on readline.
  // This preserves the exact on-disk delimiter width for both LF and CRLF,
  // which keeps incremental offsets portable across operating systems.
  for await (const chunk of stream) {
    pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);

    let newlineIndex = pending.indexOf(0x0a);
    while (newlineIndex !== -1) {
      const serializedLine = withoutTrailingCarriageReturn(pending.subarray(0, newlineIndex));
      processSerializedLine(serializedLine, events);
      offset += newlineIndex + 1;
      pending = pending.subarray(newlineIndex + 1);
      newlineIndex = pending.indexOf(0x0a);
    }
  }

  // A valid final JSON value without a newline is complete and may be
  // consumed. An invalid final fragment is probably being appended by a
  // live session, so leave the offset at its first byte for the next poll.
  if (pending.length > 0 && processSerializedLine(withoutTrailingCarriageReturn(pending), events)) {
    offset += pending.length;
  }

  return {
    usageRecords,
    toolUseEvents,
    toolResultEvents,
    compactDetected: compactEvents.detected,
    compactDetectionComplete: effectiveStartOffset === 0,
    newOffset: offset,
  };
}

function withoutTrailingCarriageReturn(line) {
  return line.length > 0 && line[line.length - 1] === 0x0d
    ? line.subarray(0, line.length - 1)
    : line;
}

function processSerializedLine(serializedLine, events) {
  if (serializedLine.length === 0) return true;

  let parsed;
  try {
    parsed = JSON.parse(serializedLine.toString('utf8'));
  } catch {
    return false;
  }
  processLine(parsed, events);
  return true;
}

function processLine(obj, { usageRecords, toolUseEvents, toolResultEvents, compactEvents }) {
  if (!obj || typeof obj !== 'object' || typeof obj.type !== 'string') {
    return;
  }

  if (isCompactEvent(obj)) compactEvents.detected = true;

  switch (obj.type) {
    case 'assistant': {
      const record = normalizeAssistantLine(obj);
      if (record) usageRecords.push(record);
      extractToolUseEvents(obj, toolUseEvents);
      break;
    }
    case 'user': {
      extractToolResultEvents(obj, toolResultEvents);
      break;
    }
    // Known-but-unused types — explicitly no-op so the switch documents
    // the observed open set rather than silently falling through.
    case 'system':
    case 'queue-operation':
    case 'attachment':
    case 'last-prompt':
    case 'ai-title':
    case 'pr-link':
      break;
    default:
      // Unknown type — silently skip (open/non-exhaustive set per spec).
      break;
  }
}

function normalizeAssistantLine(obj) {
  const message = obj.message;
  if (!message || typeof message !== 'object') return null;
  const usage = message.usage;
  if (!usage || typeof usage !== 'object') return null;

  const cacheCreation = usage.cache_creation || {};

  return {
    sessionId: obj.sessionId ?? null,
    projectCwd: obj.cwd ?? null,
    timestamp: obj.timestamp ?? null,
    model: message.model ?? null,
    inputTokens: numOr0(usage.input_tokens),
    outputTokens: numOr0(usage.output_tokens),
    cacheCreationInputTokens: numOr0(usage.cache_creation_input_tokens),
    cacheReadInputTokens: numOr0(usage.cache_read_input_tokens),
    cacheWrite5m: numOr0(cacheCreation.ephemeral_5m_input_tokens),
    cacheWrite1h: numOr0(cacheCreation.ephemeral_1h_input_tokens),
    gitBranch: obj.gitBranch ?? null,
    version: obj.version ?? null,
  };
}

function numOr0(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function extractToolUseEvents(obj, toolUseEvents) {
  const content = obj.message && Array.isArray(obj.message.content) ? obj.message.content : null;
  if (!content) return;

  for (const block of content) {
    if (!block || block.type !== 'tool_use') continue;
    const name = block.name;
    let filePath = null;
    if (TOOL_NAMES_WITH_FILE_PATH.has(name) && block.input && typeof block.input === 'object') {
      if (typeof block.input.file_path === 'string') {
        filePath = block.input.file_path;
      }
    }
    toolUseEvents.push({
      toolUseId: block.id ?? null,
      name: name ?? null,
      filePath,
      timestamp: obj.timestamp ?? null,
      sessionId: obj.sessionId ?? null,
    });
  }
}

function extractToolResultEvents(obj, toolResultEvents) {
  const content = obj.message && Array.isArray(obj.message.content) ? obj.message.content : null;
  if (!content) return;

  for (const block of content) {
    if (!block || block.type !== 'tool_result') continue;
    let contentByteLength = 0;
    try {
      contentByteLength = Buffer.byteLength(JSON.stringify(block.content ?? ''), 'utf8');
    } catch {
      contentByteLength = 0;
    }
    toolResultEvents.push({
      toolUseId: block.tool_use_id ?? null,
      contentByteLength,
      timestamp: obj.timestamp ?? null,
    });
  }
}
