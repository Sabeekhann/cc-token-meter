import { buildSummary } from './summary.js';
import { writeConfig } from '../budget/config.js';

/**
 * Handle /api/* routes. Returns true if the request was handled, false if
 * the caller should fall through to static file serving / 404.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {URL} url
 * @param {ReturnType<import('../ingest/store.js').createStore>} store
 * @returns {Promise<boolean>}
 */
export async function handleApiRoute(req, res, url, store) {
  if (url.pathname === '/api/summary' && req.method === 'GET') {
    const summary = buildSummary(store);
    sendJson(res, 200, summary);
    return true;
  }

  if (url.pathname === '/api/budget' && req.method === 'POST') {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      sendJson(res, 400, { error: 'Invalid JSON body', detail: String(err && err.message) });
      return true;
    }

    const allowedKeys = [
      'dailyTokenCap',
      'dailyCostCapUsd',
      'sessionTokenCap',
      'sessionCostCapUsd',
      'warnThresholdPct',
    ];

    const updates = {};
    for (const key of allowedKeys) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        const value = body[key];
        if (value === null || typeof value === 'number') {
          updates[key] = value;
        }
      }
    }

    const next = writeConfig(updates);
    sendJson(res, 200, { ok: true, config: next });
    return true;
  }

  return false;
}

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readJsonBody(req, maxBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    let received = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      received += chunk.length;
      if (received > maxBytes) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

export { sendJson };
