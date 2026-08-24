// Copyright 2026 FiveNodes
// SPDX-License-Identifier: Apache-2.0

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from '../ingest/store.js';
import { handleApiRoute } from './routes.js';
import { handleSseConnection } from './sse.js';
import {
  createSessionToken,
  isAuthorizedRequest,
  isLoopbackHost,
  sessionCookieHeader,
} from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');

const POLL_INTERVAL_MS = 1500;

const STATIC_ASSETS = new Map([
  ['/', { file: 'dashboard.html', contentType: 'text/html; charset=utf-8' }],
  ['/dashboard.html', { file: 'dashboard.html', contentType: 'text/html; charset=utf-8' }],
  ['/dashboard.css', { file: 'dashboard.css', contentType: 'text/css; charset=utf-8' }],
  ['/dashboard.js', { file: 'dashboard.js', contentType: 'application/javascript; charset=utf-8' }],
]);

/**
 * Start the local dashboard server: creates a store, kicks off a polling
 * loop calling store.ingestNewData(), serves allowlisted static files from
 * public/, and wires up authenticated local API routes.
 *
 * @param {{port?: number, cache?: boolean}} [opts]
 * @returns {Promise<{server: import('node:http').Server, port: number, store: object, stop: () => void}>}
 */
export async function startServer({ port = 4317, cache = true } = {}) {
  const store = createStore({ persistIndex: cache });
  const sessionToken = createSessionToken();

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
    handleRequest(req, res, store, sessionToken).catch((err) => {
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

async function handleRequest(req, res, store, sessionToken) {
  if (!isLoopbackHost(req.headers.host)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/stream' && req.method === 'GET') {
    handleSseConnection(req, res, store, sessionToken);
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    if (!isAuthorizedRequest(req, sessionToken)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

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

  serveStatic(url.pathname, res, sessionToken);
}

function serveStatic(pathname, res, sessionToken) {
  // Only files shipped with the dashboard may ever reach fs.readFile().
  // Unknown browser routes receive dashboard.html for SPA-style fallback;
  // request-controlled path text is never converted into a filesystem path.
  const asset = STATIC_ASSETS.get(pathname) || STATIC_ASSETS.get('/dashboard.html');
  const filePath = path.join(PUBLIC_DIR, asset.file);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }

    res.writeHead(200, {
      'Content-Type': asset.contentType,
      'Set-Cookie': sessionCookieHeader(sessionToken),
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Cache-Control': asset.file === 'dashboard.html' ? 'no-store' : 'no-cache',
    });
    if (res.req?.method === 'HEAD') {
      res.end();
      return;
    }
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

export function staticAssetForPath(pathname) {
  return (STATIC_ASSETS.get(pathname) || STATIC_ASSETS.get('/dashboard.html')).file;
}
