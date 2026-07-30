import fs from 'node:fs';
import readline from 'node:readline';

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
 *   newOffset: number,
 * }>}
 */
export async function parseSessionFile(filePath, { startOffset = 0 } = {}) {
  const usageRecords = [];
  const toolUseEvents = [];
  const toolResultEvents = [];

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
    return { usageRecords, toolUseEvents, toolResultEvents, newOffset: startOffset };
  }

  const stream = fs.createReadStream(filePath, {
    start: effectiveStartOffset,
    encoding: 'utf8',
  });

  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let offset = effectiveStartOffset;
  let pendingLineBytes = 0; // bytes (incl. newline) of the line currently being processed
  let sawTrailingIncomplete = false;

  // readline strips the newline delimiter; we need to track exact byte
  // lengths (including the newline) to compute correct offsets.
  // We buffer raw chunks ourselves is unnecessary — instead we recompute
  // line byte length via Buffer.byteLength(line, 'utf8') + 1 for '\n'.
  // This assumes '\n' line endings (standard for JSONL on this platform);
  // crlfDelay:Infinity in readline handles \r\n input transparently by
  // treating \r\n as a single line-break event, but the underlying file's
  // actual byte length per line may include a trailing \r we won't count.
  // This is an accepted edge case for CRLF-authored files, which JSONL
  // transcripts on macOS/Linux (the observed environment) do not use.

  for await (const line of rl) {
    const lineByteLength = Buffer.byteLength(line, 'utf8') + 1; // +1 for newline

    if (line.length === 0) {
      // Blank line — just advance offset, nothing to parse.
      offset += lineByteLength;
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      // Could be a malformed line in the middle of the file, OR the
      // trailing half-written line of a live session. We can't know for
      // certain until the loop ends. Track it as a "pending" possible
      // trailing-incomplete line; if more valid lines follow, treat this
      // one as simply malformed-and-skipped (still advance offset past it).
      // If this is the last line in the file, treat it as an incomplete
      // trailing write (do NOT advance offset).
      pendingLineBytes = lineByteLength;
      sawTrailingIncomplete = true;
      continue;
    }

    // A successfully parsed line means any prior "pending incomplete" line
    // was actually just a malformed line in the middle of the file — advance
    // past it now that we know it wasn't the true trailing line.
    if (sawTrailingIncomplete) {
      offset += pendingLineBytes;
      pendingLineBytes = 0;
      sawTrailingIncomplete = false;
    }

    processLine(parsed, { usageRecords, toolUseEvents, toolResultEvents });

    offset += lineByteLength;
  }

  // If the stream ended while `sawTrailingIncomplete` is still true, that
  // last line was genuinely incomplete/malformed at EOF — don't advance
  // offset past it, so it's re-read (and hopefully complete) next time.

  return { usageRecords, toolUseEvents, toolResultEvents, newOffset: offset };
}

function processLine(obj, { usageRecords, toolUseEvents, toolResultEvents }) {
  if (!obj || typeof obj !== 'object' || typeof obj.type !== 'string') {
    return;
  }

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
