import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSummary } from '../src/server/summary.js';
import { parseSummaryQuery } from '../src/server/routes.js';
import { applyInsightAction } from '../src/budget/insightStates.js';
import { createDashboardDemoStore } from './fixtures/dashboard-sessions.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(testDir, '..');
const publicDir = path.join(rootDir, 'public');
const port = Number(process.env.CC_TOKEN_METER_DEMO_PORT) || 4318;
const config = {
  dailyTokenCap: 2_000_000,
  dailyCostCapUsd: 20,
  sessionTokenCap: 3_000_000,
  sessionCostCapUsd: 30,
  warnThresholdPct: 80,
  // Preview subscription mode with CC_TOKEN_METER_DEMO_PLAN=pro|max5x|max20x.
  plan: process.env.CC_TOKEN_METER_DEMO_PLAN || 'api',
  planMonthlyUsd: null,
  // Preview window alerts with CC_TOKEN_METER_DEMO_BLOCK_LIMIT=<tokens>.
  blockTokenLimit: Number(process.env.CC_TOKEN_METER_DEMO_BLOCK_LIMIT) || null,
  weeklyTokenLimit: null,
  insightStates: {},
};

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
};

export function createDashboardDemoServer(options = {}) {
  const store = createDashboardDemoStore(options);

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname === '/api/summary' && req.method === 'GET') {
      try {
        const filters = parseSummaryQuery(url);
        return sendJson(res, 200, buildSummary(store, { filters, config }));
      } catch (error) {
        return sendJson(res, 400, {
          error: 'Invalid summary filters',
          detail: String(error && error.message),
        });
      }
    }

    if (url.pathname === '/api/insights' && req.method === 'POST') {
      // In-memory only: the synthetic preview never writes local config.
      const body = await readDemoBody(req);
      try {
        config.insightStates = applyInsightAction(config.insightStates, body);
        return sendJson(res, 200, { ok: true });
      } catch (error) {
        return sendJson(res, 400, { error: 'Invalid insight action', detail: String(error && error.message) });
      }
    }

    if (url.pathname === '/api/budget' && req.method === 'POST') {
      return sendJson(res, 200, { ok: true, config });
    }

    if (url.pathname === '/api/stream' && req.method === 'GET') {
      const summary = buildSummary(store, { config });
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(`event: message\ndata: ${JSON.stringify(summary)}\n\n`);
      const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 15_000);
      req.on('close', () => clearInterval(keepAlive));
      return;
    }

    const requested = url.pathname === '/' ? 'dashboard.html' : url.pathname.replace(/^\/+/, '');
    const resolved = path.resolve(publicDir, requested);
    if (!resolved.startsWith(publicDir + path.sep)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    fs.readFile(resolved, (error, data) => {
      if (error) {
        res.writeHead(404).end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': types[path.extname(resolved)] || 'application/octet-stream' });
      res.end(data);
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = createDashboardDemoServer();
  server.listen(port, '127.0.0.1', () => {
    console.log(`Synthetic dashboard preview: http://127.0.0.1:${port}`);
  });
}

function readDemoBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size <= 16_384) chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}
