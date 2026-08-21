import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from '../ingest/store.js';
import { handleApiRoute } from './routes.js';
import { handleSseConnection } from './sse.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');

const POLL_INTERVAL_MS = 1500;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/**
 * Start the local dashboard server: creates a store, kicks off a polling
 * loop calling store.ingestNewData(), serves static files from public/,
 * and wires up API routes.
 *
 * @param {{port?: number, cache?: boolean}} [opts]
 * @returns {Promise<{server: import('node:http').Server, port: number, store: object, stop: () => void}>}
 */
export async function startServer({ port = 4317, cache = true } = {}) {
  const store = createStore({ persistIndex: cache });

  // Kick off an initial cold scan before accepting requests, so the first
  // page load isn't empty.
  await store.ingestNewData();

  const pollInterval = setInterval(() => {
    store.ingestNewData().catch((err) => {
      console.error('cc-token-meter: ingestion error:', err);
    });
  }, POLL_INTERVAL_MS);
  pollInterval.unref?.();

  const server = http.createServer((req, res) => {
    handleRequest(req, res, store).catch((err) => {
      console.error('cc-token-meter: request handler error:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    });
  });

  const actualPort = await listenOnFreePort(server, port);

  const stop = () => {
    clearInterval(pollInterval);
    server.close();
  };

  return { server, port: actualPort, store, stop };
}

async function handleRequest(req, res, store) {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/stream' && req.method === 'GET') {
    handleSseConnection(req, res, store);
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    const handled = await handleApiRoute(req, res, url, store);
    if (handled) return;
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method not allowed');
    return;
  }

  serveStatic(url.pathname, res);
}

function serveStatic(pathname, res) {
  let relativePath = pathname === '/' ? '/dashboard.html' : pathname;

  // Prevent path traversal outside PUBLIC_DIR.
  const safePath = path.normalize(relativePath).replace(/^(\.\.[/\\])+/, '');
  let filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // Fall back to dashboard.html for unknown routes (simple SPA-style
      // fallback), otherwise 404.
      if (relativePath !== '/dashboard.html') {
        return serveStatic('/dashboard.html', res);
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
  });
}

function listenOnFreePort(server, startPort, maxAttempts = 20) {
  return new Promise((resolve, reject) => {
    let attempt = 0;

    function tryListen(port) {
      const onError = (err) => {
        if (err.code === 'EADDRINUSE' && attempt < maxAttempts) {
          attempt += 1;
          server.removeListener('error', onError);
          tryListen(port + 1);
        } else {
          server.removeListener('error', onError);
          reject(err);
        }
      };

      server.once('error', onError);
      // The dashboard handles local transcript metadata and is deliberately
      // inaccessible from other machines on the network.
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', onError);
        resolve(port);
      });
    }

    tryListen(startPort);
  });
}
