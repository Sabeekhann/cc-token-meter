/**
 * Return whether a parsed transcript line is evidence that context was
 * compacted. Claude Code has used both an explicit compact-boundary system
 * event and command text in user messages, so keep the detector tolerant of
 * both shapes without retaining any transcript content.
 *
 * @param {object} line
 * @returns {boolean}
 */
export function isCompactEvent(line) {
  if (!line || typeof line !== 'object') return false;

  if (line.type === 'system') {
    if (line.subtype === 'compact_boundary') return true;
    const text = extractTextContent(line);
    return typeof text === 'string' && text.toLowerCase().includes('compact');
  }

  if (line.type !== 'user') return false;

  const text = extractTextContent(line);
  if (typeof text !== 'string') return false;
  const trimmed = text.trim();
  return (
    trimmed.startsWith('/compact') ||
    /<command-name>\s*\/compact\s*<\/command-name>/i.test(trimmed)
  );
}

/**
 * Resolve compact-detection evidence from an aggregate flag or parsed lines.
 * `null` means the caller has no evidence covering the session and must not
 * claim that compaction did not occur.
 *
 * @param {Array<object>} rawLines
 * @param {boolean} [precomputedFlag]
 * @returns {boolean|null}
 */
export function detectCompactEvent(rawLines, precomputedFlag) {
  if (typeof precomputedFlag === 'boolean') return precomputedFlag;
  if (!Array.isArray(rawLines) || rawLines.length === 0) return null;
  return rawLines.some(isCompactEvent);
}

function extractTextContent(line) {
  if (typeof line.content === 'string') return line.content;
  if (line.message && typeof line.message.content === 'string') return line.message.content;
  if (line.message && Array.isArray(line.message.content)) {
    return line.message.content
      .filter((block) => block && typeof block.text === 'string')
      .map((block) => block.text)
      .join(' ');
  }
  return null;
}
