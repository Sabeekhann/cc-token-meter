import { startServer } from '../../server/index.js';

/**
 * Default command: start the local dashboard server and open the browser
 * (unless --no-open was passed).
 *
 * @param {{port: number, open: boolean, cache: boolean}} opts
 */
export async function startCommand({ port, open, cache }) {
  const { port: actualPort, stop } = await startServer({ port, cache });
  const url = `http://localhost:${actualPort}`;

  console.log(`cc-token-meter dashboard running at ${url}`);
  console.log('100% local — no data leaves your machine. Press Ctrl+C to stop.');

  if (open) {
    try {
      const { default: openBrowser } = await import('open');
      await openBrowser(url);
    } catch (err) {
      console.warn('cc-token-meter: could not auto-open browser:', err && err.message ? err.message : err);
      console.warn(`Open this URL manually: ${url}`);
    }
  }

  const shutdown = () => {
    console.log('\ncc-token-meter: shutting down...');
    stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep the process alive; startServer's poll interval is unref'd so it
  // won't itself keep the event loop alive — the HTTP server listening
  // does that for us.
  return new Promise(() => {}); // never resolves; process exits via signal handlers
}
