// Copyright 2026 FiveNodes
// SPDX-License-Identifier: Apache-2.0

import { buildSummary } from './summary.js';
import { isAuthorizedRequest } from './auth.js';

const SSE_PUSH_INTERVAL_MS = 1500;

/**
 * Handle a GET /api/stream SSE connection. Sends a full summary snapshot
 * immediately, then again after every ingestion cycle that changed
 * something (detected through the store's monotonic revision counter).
 * Cleans up its interval/listener on client disconnect.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {ReturnType<import('../ingest/store.js').createStore>} store
 * @param {string} sessionToken
 */
export function handleSseConnection(req, res, store, sessionToken) {
  if (!isAuthorizedRequest(req, sessionToken)) {
    res.writeHead(401, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  let lastSentRevision = -1;

  function pushSnapshot(force = false) {
    const snapshot = store.getSnapshot();
    const revision = Number.isInteger(snapshot.revision)
      ? snapshot.revision
      : snapshot.totalIngestedMessages;
    if (!force && revision === lastSentRevision) {
      return;
    }
    const summary = buildSummary(store);
    lastSentRevision = revision;
    res.write(`event: message\ndata: ${JSON.stringify(summary)}\n\n`);
  }

  // Initial snapshot on connect, always sent regardless of change detection.
  pushSnapshot(true);

  const interval = setInterval(() => {
    pushSnapshot(false);
  }, SSE_PUSH_INTERVAL_MS);

  const cleanup = () => {
    clearInterval(interval);
  };

  req.on('close', cleanup);
  req.on('error', cleanup);
}
