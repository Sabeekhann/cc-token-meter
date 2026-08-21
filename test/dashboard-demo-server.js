import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(testDir, '..');
const publicDir = path.join(rootDir, 'public');
const summaryPath = path.join(testDir, 'fixtures', 'dashboard-summary.json');
const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
const port = Number(process.env.CC_TOKEN_METER_DEMO_PORT) || 4318;

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/summary' && req.method === 'GET') {
    return sendJson(res, summary);
  }

  if (url.pathname === '/api/budget' && req.method === 'POST') {
    return sendJson(res, { ok: true, config: summary.config });
  }

  if (url.pathname === '/api/stream' && req.method === 'GET') {
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

server.listen(port, '127.0.0.1', () => {
  console.log(`Synthetic dashboard preview: http://127.0.0.1:${port}`);
});

function sendJson(res, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}
