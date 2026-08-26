import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { discoverSessionFiles } from '../src/ingest/discover.js';
import { HOME_OVERRIDE_ENV } from '../src/paths.js';

test('discovers transcripts when the home path contains spaces and glob metacharacters', async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-token-meter-discover-'));
  const previousHome = process.env[HOME_OVERRIDE_ENV];
  const home = path.join(temporaryRoot, 'home [literal] with spaces');
  const project = path.join(home, '.claude', 'projects', '-synthetic-project');
  const transcript = path.join(project, 'synthetic-session.jsonl');

  try {
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(transcript, '{}\n', 'utf8');
    process.env[HOME_OVERRIDE_ENV] = home;

    const files = await discoverSessionFiles();

    assert.deepEqual(files.map((file) => file.filePath), [transcript]);
    assert.equal(files[0].sessionId, 'synthetic-session');
    assert.equal(files[0].projectDirName, '-synthetic-project');
  } finally {
    if (previousHome === undefined) delete process.env[HOME_OVERRIDE_ENV];
    else process.env[HOME_OVERRIDE_ENV] = previousHome;
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('discovers only one-level regular jsonl transcripts and returns deterministic order', async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-token-meter-discover-shape-'));
  const previousHome = process.env[HOME_OVERRIDE_ENV];
  const home = path.join(temporaryRoot, 'home');
  const projects = path.join(home, '.claude', 'projects');

  try {
    const projectB = path.join(projects, '-project-b');
    const projectA = path.join(projects, '-project-a');
    fs.mkdirSync(path.join(projectA, 'nested'), { recursive: true });
    fs.mkdirSync(projectB, { recursive: true });

    fs.writeFileSync(path.join(projectB, 'z-session.jsonl'), '{}\n', 'utf8');
    fs.writeFileSync(path.join(projectA, 'b-session.jsonl'), '{}\n', 'utf8');
    fs.writeFileSync(path.join(projectA, 'a-session.jsonl'), '{}\n', 'utf8');
    fs.writeFileSync(path.join(projectA, 'ignore.txt'), '{}\n', 'utf8');
    fs.writeFileSync(path.join(projectA, 'nested', 'ignore.jsonl'), '{}\n', 'utf8');
    fs.mkdirSync(path.join(projectA, 'directory.jsonl'));
    process.env[HOME_OVERRIDE_ENV] = home;

    const files = await discoverSessionFiles();

    assert.deepEqual(
      files.map(({ projectDirName, sessionId }) => [projectDirName, sessionId]),
      [
        ['-project-a', 'a-session'],
        ['-project-a', 'b-session'],
        ['-project-b', 'z-session'],
      ],
    );
  } finally {
    if (previousHome === undefined) delete process.env[HOME_OVERRIDE_ENV];
    else process.env[HOME_OVERRIDE_ENV] = previousHome;
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('missing projects directory returns an empty discovery result', async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-token-meter-discover-missing-'));
  const previousHome = process.env[HOME_OVERRIDE_ENV];

  try {
    process.env[HOME_OVERRIDE_ENV] = path.join(temporaryRoot, 'never-created-home');
    assert.deepEqual(await discoverSessionFiles(), []);
  } finally {
    if (previousHome === undefined) delete process.env[HOME_OVERRIDE_ENV];
    else process.env[HOME_OVERRIDE_ENV] = previousHome;
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
