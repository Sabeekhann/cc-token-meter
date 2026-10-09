// Copyright 2026 FiveNodes
// SPDX-License-Identifier: Apache-2.0

import { computeCost } from '../pricing/cost.js';

/**
 * Comparison models for the what-if simulator. Prices always come from the
 * pricing table through computeCost(), so these entries name a model and
 * never carry a price of their own.
 */
export const WHAT_IF_TARGETS = [
  { model: 'claude-fable-5', label: 'Fable 5' },
  { model: 'claude-opus-5', label: 'Opus 5' },
  { model: 'claude-sonnet-5', label: 'Sonnet 5' },
  { model: 'claude-haiku-4-5', label: 'Haiku 4.5' },
];

/**
 * Reprice the same token usage on other models. Cost is linear in each token
 * component, so session totals are enough: no per-message work is needed.
 * Targets are priced at the pricing row in effect at `now`.
 *
 * This answers "what would these exact tokens cost on model X", not "what
 * would this work have cost": another model may need more or fewer tokens
 * and produce different results.
 *
 * @param {Array<object>} sessions session aggregates (already scope-filtered)
 * @param {{now?: Date|string|number, targets?: Array<{model: string, label: string}>, pricingTable?: Array<object>}} [options]
 */
export function buildWhatIf(sessions, { now = Date.now(), targets = WHAT_IF_TARGETS, pricingTable } = {}) {
  const pricedAt = new Date(now).toISOString();
  const list = Array.isArray(sessions) ? sessions : [];
  const scopeTokens = emptyTokens();
  const projects = new Map();
  let actualCostUsd = 0;
  let estimated = false;

  for (const session of list) {
    const key = session.projectCwd || session.projectDirNameFallback || 'unknown';
    let project = projects.get(key);
    if (!project) {
      project = { project: key, actualCostUsd: 0, estimated: false, tokens: emptyTokens() };
      projects.set(key, project);
    }
    addTokens(scopeTokens, session);
    addTokens(project.tokens, session);
    const cost = Number.isFinite(session.costUsd) ? session.costUsd : 0;
    actualCostUsd += cost;
    project.actualCostUsd += cost;
    if (session.estimatedCostUsed === true) {
      estimated = true;
      project.estimated = true;
    }
  }

  const price = (tokens, actual) => targets.map((target) => {
    const { totalCost } = computeCost(
      { ...tokens, model: target.model, timestamp: pricedAt },
      ...(pricingTable ? [pricingTable] : []),
    );
    return {
      model: target.model,
      label: target.label,
      costUsd: totalCost,
      deltaUsd: totalCost - actual,
      deltaRatio: actual > 0 ? (totalCost - actual) / actual : null,
    };
  });

  return {
    pricedAt,
    targets: targets.map(({ model, label }) => ({ model, label })),
    scope: { actualCostUsd, estimated, costs: price(scopeTokens, actualCostUsd) },
    byProject: Array.from(projects.values())
      .sort((a, b) => b.actualCostUsd - a.actualCostUsd)
      .map((project) => ({
        project: project.project,
        actualCostUsd: project.actualCostUsd,
        estimated: project.estimated,
        costs: price(project.tokens, project.actualCostUsd),
      })),
  };
}

function emptyTokens() {
  return { inputTokens: 0, outputTokens: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheReadInputTokens: 0 };
}

function addTokens(target, session) {
  for (const key of Object.keys(target)) {
    target[key] += Number.isFinite(session[key]) ? session[key] : 0;
  }
}
