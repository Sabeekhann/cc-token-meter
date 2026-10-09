// Copyright 2026 FiveNodes
// SPDX-License-Identifier: Apache-2.0

import { createHash } from 'node:crypto';

export const INSIGHT_ACTIONS = new Set(['dismiss', 'snooze', 'restore']);
export const MAX_SNOOZE_DAYS = 90;
const MAX_TRACKED_INSIGHTS = 500;
const DAY_MS = 24 * 60 * 60 * 1000;
const KEY_PATTERN = /^[0-9a-f]{16}$/;

/**
 * Insight ids can contain local file paths (repeated-read tips name the
 * file), so config.json stores a short one-way hash of the id instead.
 *
 * @param {string} insightId
 */
export function insightKey(insightId) {
  return createHash('sha256').update(String(insightId)).digest('hex').slice(0, 16);
}

/**
 * Apply one dismiss/snooze/restore action and return a new, bounded state
 * map. Expired snoozes are dropped; when over the limit, the oldest entries
 * go first.
 *
 * @param {Record<string, {status: 'dismissed'|'snoozed', at: string, until?: string}>} states
 * @param {{id: string, action: 'dismiss'|'snooze'|'restore', days?: number}} request
 * @param {Date|string|number} [now]
 */
export function applyInsightAction(states, request, now = Date.now()) {
  const { id, action } = request || {};
  if (typeof id !== 'string' || id.trim() === '' || id.length > 4096) {
    throw new RangeError('insight id must be a non-empty string');
  }
  if (!INSIGHT_ACTIONS.has(action)) {
    throw new RangeError('action must be one of: dismiss, snooze, restore');
  }
  const nowMs = new Date(now).getTime();
  const at = new Date(nowMs).toISOString();
  const next = pruneInsightStates(states, nowMs);
  const key = insightKey(id);

  if (action === 'restore') {
    delete next[key];
  } else if (action === 'dismiss') {
    next[key] = { status: 'dismissed', at };
  } else {
    const days = request.days;
    if (!Number.isInteger(days) || days < 1 || days > MAX_SNOOZE_DAYS) {
      throw new RangeError(`snooze days must be an integer from 1 to ${MAX_SNOOZE_DAYS}`);
    }
    next[key] = { status: 'snoozed', at, until: new Date(nowMs + days * DAY_MS).toISOString() };
  }

  return limitInsightStates(next);
}

/**
 * Validate a stored state map, dropping malformed entries and expired
 * snoozes rather than failing.
 */
export function pruneInsightStates(states, now = Date.now()) {
  const nowMs = new Date(now).getTime();
  const next = {};
  if (!states || typeof states !== 'object' || Array.isArray(states)) return next;
  for (const [key, state] of Object.entries(states)) {
    if (!KEY_PATTERN.test(key) || !state || typeof state !== 'object') continue;
    if (!Number.isFinite(Date.parse(state.at))) continue;
    if (state.status === 'dismissed') {
      next[key] = { status: 'dismissed', at: state.at };
    } else if (state.status === 'snoozed' && Date.parse(state.until) > nowMs) {
      next[key] = { status: 'snoozed', at: state.at, until: state.until };
    }
  }
  return next;
}

function limitInsightStates(states) {
  const entries = Object.entries(states);
  if (entries.length <= MAX_TRACKED_INSIGHTS) return states;
  entries.sort((a, b) => Date.parse(b[1].at) - Date.parse(a[1].at));
  return Object.fromEntries(entries.slice(0, MAX_TRACKED_INSIGHTS));
}

/**
 * Split tips into those to show and those the user dismissed or snoozed.
 *
 * @param {Array<{id: string}>} tips
 * @param {Record<string, object>} states
 */
export function partitionTips(tips, states, now = Date.now()) {
  const active = pruneInsightStates(states, now);
  const visible = [];
  const hidden = [];
  for (const tip of Array.isArray(tips) ? tips : []) {
    const state = active[insightKey(tip.id)];
    if (state) hidden.push({ ...tip, userState: state });
    else visible.push(tip);
  }
  return { visible, hidden };
}
