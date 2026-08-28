import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createDashboardDemoServer } from '../../test/dashboard-demo-server.js';
import { DASHBOARD_DEMO_MODELS } from '../../test/fixtures/dashboard-sessions.js';

const chrome = findChrome();
const server = createDashboardDemoServer({ now: new Date('2026-08-28T12:00:00.000Z') });
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});

try {
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;

  await withBrowser(async (cdp) => {
    const model = DASHBOARD_DEMO_MODELS[1];
    const modelSummary = await getJson(`${base}/api/summary?model=${encodeURIComponent(model)}`);
    const modelState = await inspectProjects(
      cdp,
      `${base}/?model=${encodeURIComponent(model)}#projects`,
      [model, `${modelSummary.byProject.length} project`],
    );
    assert.match(modelState.summary, new RegExp(escapeRegex(model)));
    assert.match(modelState.summary, new RegExp(`${modelSummary.byProject.length} project`));
    assert.doesNotMatch(modelState.summary, /Updating filtered local usage/);

    const emptyState = await inspectProjects(
      cdp,
      `${base}/?from=2999-01-01&to=2999-01-02#projects`,
      ['2999-01-01', '0 projects'],
    );
    assert.match(emptyState.summary, /Custom range · 2999-01-01 to 2999-01-02 · 0 projects · 0 tokens · \$0\.00/);
    assert.match(emptyState.table, /No project usage matches the selected filters/);
    assert.doesNotMatch(emptyState.summary, /Updating filtered local usage/);
  });

  console.log('[dashboard-browser] settled model/date Projects scopes passed');
} finally {
  await new Promise((resolve) => server.close(resolve));
}

function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  assert.ok(found, 'A Chromium/Chrome executable is required for the dashboard browser contract');
  return found;
}

async function getJson(url) {
  const response = await fetch(url);
  assert.equal(response.status, 200);
  return response.json();
}

async function withBrowser(run) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-token-meter-chrome-'));
  const child = spawn(chrome, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--disable-background-networking',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  try {
    const debugFile = path.join(profile, 'DevToolsActivePort');
    await waitUntil(() => fs.existsSync(debugFile), 8000, `Chrome did not expose DevTools: ${stderr.slice(-800)}`);
    const [port] = fs.readFileSync(debugFile, 'utf8').trim().split(/\r?\n/);
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = targets.find((target) => target.type === 'page');
    assert.ok(page?.webSocketDebuggerUrl, 'Chrome did not expose a page target');
    const cdp = await connectCdp(page.webSocketDebuggerUrl);
    try {
      await cdp.send('Page.enable');
      await run(cdp);
    } finally {
      cdp.close();
    }
  } finally {
    child.kill('SIGKILL');
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

async function inspectProjects(cdp, url, expectedSummaryParts) {
  await cdp.send('Page.navigate', { url });
  await waitUntil(async () => {
    const state = await readProjects(cdp);
    return expectedSummaryParts.every((part) => state.summary.includes(part)) &&
      !state.summary.includes('Updating filtered local usage');
  }, 8000, `Projects view did not settle for ${url}`);
  return readProjects(cdp);
}

async function readProjects(cdp) {
  const result = await cdp.send('Runtime.evaluate', {
    expression: `JSON.stringify({summary:document.getElementById('projectFilterSummary')?.textContent||'',table:document.getElementById('projectsTable')?.textContent||'',connection:document.getElementById('connectionStatus')?.textContent||''})`,
    returnByValue: true,
  });
  return JSON.parse(result.result.value || '{}');
}

function connectCdp(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let nextId = 1;
    const pending = new Map();
    ws.addEventListener('open', () => resolve({
      send(method, params = {}) {
        const id = nextId++;
        return new Promise((res, rej) => {
          pending.set(id, { res, rej });
          ws.send(JSON.stringify({ id, method, params }));
        });
      },
      close() { ws.close(); },
    }));
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id || !pending.has(message.id)) return;
      const { res, rej } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) rej(new Error(message.error.message || 'CDP command failed'));
      else res(message.result || {});
    });
    ws.addEventListener('error', () => reject(new Error('Could not connect to Chrome DevTools')));
  });
}

async function waitUntil(predicate, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
