import { createStore } from '../../ingest/store.js';
import { buildSummary } from '../../server/summary.js';

/**
 * Cold-scan all history and print a JSON summary to stdout, then exit.
 * No server is started.
 */
export async function jsonCommand() {
  const store = createStore();
  await store.ingestNewData();
  const summary = buildSummary(store);
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
}
