// Copyright 2026 FiveNodes
// SPDX-License-Identifier: Apache-2.0

import path from 'node:path';
import { createStore } from '../../ingest/store.js';
import { buildSummary } from '../../server/summary.js';
import { buildWeeklyReport } from '../../analytics/weeklyReport.js';
import { writePrivateFile } from './csv.js';

/**
 * Write the weekly Markdown report to a file (owner-only permissions) or to
 * stdout with `-`. Project names are pseudonymized unless showNames is set.
 */
export async function reportCommand({ cache = true, outputPath, showNames = false } = {}) {
  if (!outputPath) throw new Error('--report requires a destination path or `-` for stdout');
  const store = createStore({ persistIndex: cache });
  await store.ingestNewData();
  const report = buildWeeklyReport(buildSummary(store), { showNames });

  if (outputPath === '-') {
    process.stdout.write(report);
    return;
  }
  writePrivateFile(outputPath, report);
  console.log(`Wrote weekly report to ${path.resolve(outputPath)}${showNames ? ' (includes project names)' : ''}`);
}
