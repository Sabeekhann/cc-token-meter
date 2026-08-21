import { createStore } from '../../ingest/store.js';
import { buildSummary } from '../../server/summary.js';

/**
 * Restore/index history and print a JSON summary to stdout, then exit.
 * No server is started. Pass cache:false for an uncached full scan.
 */
export async function jsonCommand({ cache = true, filters = {} } = {}) {
  const store = createStore({ persistIndex: cache });
  await store.ingestNewData();
  const summary = buildSummary(store, { filters });
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
}
