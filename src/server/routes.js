// Copyright 2026 FiveNodes
// SPDX-License-Identifier: Apache-2.0

import { buildSummary } from './summary.js';
import { writeConfig } from '../budget/config.js';

const MAX_PROJECT_FILTER_LENGTH = 1024;
const MAX_MODEL_FILTER_LENGTH = 256;

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
    let filters;
    try {
      filters = parseSummaryQuery(url);
    } catch (err) {
      sendJson(res, 400, { error: 'Invalid summary filters', detail: String(err && err.message) });
      return true;
    }
    const summary = buildSummary(store, { filters });
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
      if (Object.prototype.hasOwnProperty.call(body, key)) updates[key] = body[key];
    }

    try {
      const next = writeConfig(updates);
      sendJson(res, 200, { ok: true, config: next });
    } catch (err) {
      sendJson(res, 400, { error: 'Invalid budget config', detail: String(err && err.message) });
    }
    return true;
  }

  return false;
}

export function parseSummaryQuery(url) {
  const from = readSingleQueryValue(url.searchParams, 'from', 10);
  const to = readSingleQueryValue(url.searchParams, 'to', 10);
  const project = readSingleQueryValue(url.searchParams, 'project', MAX_PROJECT_FILTER_LENGTH);
  const model = readSingleQueryValue(url.searchParams, 'model', MAX_MODEL_FILTER_LENGTH);

  if (from) validateDate('from', from);
  if (to) validateDate('to', to);
  if (from && to && from > to) {
    throw new Error(`from (${from}) must not be after to (${to})`);
  }

  return { from, to, project, model };
}

function readSingleQueryValue(searchParams, name, maxLength) {
  const values = searchParams.getAll(name);
  if (values.length > 1) throw new Error(`${name} must be provided at most once`);
  if (values.length === 0) return null;

  const value = values[0].trim();
  if (!value) return null;
  if (value.length > maxLength) {
    throw new Error(`${name} exceeds the maximum length of ${maxLength} characters`);
  }
  return value;
}

function validateDate(name, value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${name} requires YYYY-MM-DD, got: ${value}`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${name} requires a real calendar date, got: ${value}`);
  }
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
