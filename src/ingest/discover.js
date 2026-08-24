import path from 'node:path';
import fs from 'node:fs';
import { glob } from 'glob';
import { resolveProjectsDirectory } from '../paths.js';

/**
 * Discover all Claude Code session transcript files on disk.
 *
 * Claude Code writes to ~/.claude/projects/<sanitized-cwd>/<uuid>.jsonl
 * There is also a same-named sibling directory <uuid>/ next to the .jsonl file,
 * so we glob *.jsonl specifically to avoid picking up directories.
 *
 * @returns {Promise<Array<{sessionId: string, projectDirName: string, filePath: string, mtimeMs: number, size: number}>>}
 */
export async function discoverSessionFiles() {
  const projectsRoot = resolveProjectsDirectory();
  const pattern = path.join(projectsRoot, '*', '*.jsonl');

  let files;
  try {
    files = await glob(pattern, { nodir: true });
  } catch (err) {
    // Projects dir may not exist yet (fresh install / never used Claude Code).
    return [];
  }

  const results = [];
  for (const filePath of files) {
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      // File may have been removed between glob and stat — skip.
      continue;
    }

    const projectDirName = path.basename(path.dirname(filePath));
    const sessionId = path.basename(filePath, '.jsonl');

    results.push({
      sessionId,
      projectDirName,
      filePath,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
    });
  }

  return results;
}

/**
 * Best-effort reversal of the directory-name sanitization Claude Code applies
 * to the absolute project path (replaces '/' with '-'). This reversal is
 * LOSSY for paths that themselves contain literal hyphens, since we cannot
 * distinguish a hyphen that was originally a slash from a hyphen that was
 * already part of a directory name.
 *
 * Only use this as a fallback when no lines have been parsed yet for a
 * session — prefer the `cwd` field from parsed transcript lines, which is
 * authoritative.
 *
 * @param {string} projectDirName
 * @returns {string}
 */
export function deriveProjectPath(projectDirName) {
  if (!projectDirName) return projectDirName;
  if (!projectDirName.startsWith('-')) {
    // Doesn't look like a sanitized absolute path; return as-is.
    return projectDirName;
  }
  return projectDirName.replace(/-/g, '/');
}
