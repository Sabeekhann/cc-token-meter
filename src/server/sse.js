import { buildSummary } from './summary.js';

const SSE_PUSH_INTERVAL_MS = 1500;

/**
 * Handle a GET /api/stream SSE connection. Sends a full summary snapshot
 * immediately, then again after every ingestion cycle that changed
 * something (detected via the store's totalIngestedMessages counter).
 * Cleans up its interval/listener on client disconnect.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {ReturnType<import('../ingest/store.js').createStore>} store
 */
export function handleSseConnection(req, res, store) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  let lastSentMessageCount = -1;

  function pushSnapshot(force = false) {
    const summary = buildSummary(store);
    if (!force && summary.totalIngestedMessages === lastSentMessageCount) {
      return;
    }
    lastSentMessageCount = summary.totalIngestedMessages;
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
