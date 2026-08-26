import path from 'node:path';
import fs from 'node:fs';
import { resolveProjectsDirectory } from '../paths.js';

/**
 * Discover all Claude Code session transcript files on disk.
 *
 * Claude Code writes to ~/.claude/projects/<sanitized-cwd>/<uuid>.jsonl.
 * There is also a same-named sibling directory <uuid>/ next to the .jsonl file,
 * so discovery intentionally inspects exactly one project-directory level and
 * accepts regular files ending in .jsonl only.
 *
 * @returns {Promise<Array<{sessionId: string, projectDirName: string, filePath: string, mtimeMs: number, size: number}>>}
 */
export async function discoverSessionFiles() {
  const projectsRoot = resolveProjectsDirectory();

  let projectEntries;
  try {
    projectEntries = fs.readdirSync(projectsRoot, { withFileTypes: true });
  } catch {
    // Projects dir may not exist yet (fresh install / never used Claude Code).
    return [];
  }

  const results = [];
  for (const projectEntry of projectEntries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!projectEntry.isDirectory()) continue;

    const projectPath = path.join(projectsRoot, projectEntry.name);
    let transcriptEntries;
    try {
      transcriptEntries = fs.readdirSync(projectPath, { withFileTypes: true });
    } catch {
      // A project directory may disappear or become unreadable during discovery.
      continue;
    }

    for (const transcriptEntry of transcriptEntries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!transcriptEntry.isFile() || path.extname(transcriptEntry.name) !== '.jsonl') continue;

      const filePath = path.join(projectPath, transcriptEntry.name);
      let stat;
      try {
        stat = fs.statSync(filePath);
      } catch {
        // File may have been removed between directory enumeration and stat.
        continue;
      }

      results.push({
        sessionId: path.basename(transcriptEntry.name, '.jsonl'),
        projectDirName: projectEntry.name,
        filePath,
        mtimeMs: stat.mtimeMs,
        size: stat.size,
      });
    }
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
