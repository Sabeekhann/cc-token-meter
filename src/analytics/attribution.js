// Copyright 2026 FiveNodes
// SPDX-License-Identifier: Apache-2.0

import { tokenTotal } from '../ingest/aggregate.js';

// Tool results are measured in bytes. Four bytes per token is a rough
// average for English text and code; it is only used for display estimates.
const BYTES_PER_TOKEN_ESTIMATE = 4;
const TOP_TOOL_LIMIT = 15;
const MCP_TOOL_PATTERN = /^mcp__(.+?)__(.+)$/;

/**
 * Attribute usage to subagents and tools. Subagent aggregates are the
 * sessions carrying `parentSessionId`; their type comes from the parent's
 * `subagentTypes`. Tool counters come from `toolStatsByDay`.
 *
 * @param {Array<object>} sessions all sessions in scope, main and subagent
 */
export function buildAttribution(sessions, { topTools = TOP_TOOL_LIMIT } = {}) {
  const list = Array.isArray(sessions) ? sessions : [];
  const agentTypes = new Map();
  for (const session of list) {
    for (const [agentId, agentType] of Object.entries(session.subagentTypes || {})) {
      agentTypes.set(`${session.sessionId}:${agentId}`, agentType);
    }
  }

  let scopeTokens = 0;
  const subagentTotals = { runs: 0, tokenTotal: 0, costUsd: 0, messageCount: 0 };
  const byType = new Map();
  const tools = new Map();

  for (const session of list) {
    const tokens = tokenTotal(session);
    scopeTokens += tokens;

    if (session.parentSessionId) {
      const type = agentTypes.get(`${session.parentSessionId}:${session.agentId}`) || null;
      const key = type || 'unknown';
      const bucket = byType.get(key) || { agentType: type, runs: 0, tokenTotal: 0, costUsd: 0, messageCount: 0 };
      bucket.runs += 1;
      bucket.tokenTotal += tokens;
      bucket.costUsd += finite(session.costUsd);
      bucket.messageCount += finite(session.messageCount);
      byType.set(key, bucket);
      subagentTotals.runs += 1;
      subagentTotals.tokenTotal += tokens;
      subagentTotals.costUsd += finite(session.costUsd);
      subagentTotals.messageCount += finite(session.messageCount);
    }

    for (const day of Object.values(session.toolStatsByDay || {})) {
      for (const [name, stat] of Object.entries(day || {})) {
        const bucket = tools.get(name) || { name, calls: 0, resultBytes: 0 };
        bucket.calls += finite(stat && stat.calls);
        bucket.resultBytes += finite(stat && stat.resultBytes);
        tools.set(name, bucket);
      }
    }
  }

  const toolRows = Array.from(tools.values()).map((tool) => {
    const mcp = MCP_TOOL_PATTERN.exec(tool.name);
    return {
      ...tool,
      server: mcp ? mcp[1] : null,
      estimatedTokens: Math.round(tool.resultBytes / BYTES_PER_TOKEN_ESTIMATE),
    };
  });
  const servers = new Map();
  for (const tool of toolRows) {
    if (!tool.server) continue;
    const bucket = servers.get(tool.server) || { server: tool.server, tools: 0, calls: 0, resultBytes: 0, estimatedTokens: 0 };
    bucket.tools += 1;
    bucket.calls += tool.calls;
    bucket.resultBytes += tool.resultBytes;
    bucket.estimatedTokens += tool.estimatedTokens;
    servers.set(tool.server, bucket);
  }

  const byResultSize = (a, b) => b.resultBytes - a.resultBytes || b.calls - a.calls || a.name.localeCompare(b.name);
  return {
    subagents: {
      ...subagentTotals,
      share: scopeTokens > 0 ? subagentTotals.tokenTotal / scopeTokens : 0,
      byType: Array.from(byType.values()).sort((a, b) => b.tokenTotal - a.tokenTotal),
    },
    tools: toolRows.sort(byResultSize).slice(0, topTools),
    toolTotals: {
      distinctTools: toolRows.length,
      calls: toolRows.reduce((sum, tool) => sum + tool.calls, 0),
      resultBytes: toolRows.reduce((sum, tool) => sum + tool.resultBytes, 0),
    },
    mcpServers: Array.from(servers.values()).sort((a, b) => b.resultBytes - a.resultBytes || a.server.localeCompare(b.server)),
    bytesPerTokenEstimate: BYTES_PER_TOKEN_ESTIMATE,
  };
}

/**
 * Group subagent aggregates under their parent session id.
 *
 * @param {Array<object>} sessions
 * @returns {Map<string, Array<{agentId: string, agentType: string|null, tokenTotal: number, costUsd: number, messageCount: number, models: string[]}>>}
 */
export function subagentsByParent(sessions) {
  const list = Array.isArray(sessions) ? sessions : [];
  const parents = new Map(list.filter((s) => !s.parentSessionId).map((s) => [s.sessionId, s]));
  const grouped = new Map();
  for (const session of list) {
    if (!session.parentSessionId) continue;
    const parent = parents.get(session.parentSessionId);
    const entry = {
      agentId: session.agentId,
      agentType: (parent && parent.subagentTypes && parent.subagentTypes[session.agentId]) || null,
      tokenTotal: tokenTotal(session),
      costUsd: finite(session.costUsd),
      messageCount: finite(session.messageCount),
      models: Array.isArray(session.models) ? session.models : Array.from(session.models || []),
    };
    const siblings = grouped.get(session.parentSessionId) || [];
    siblings.push(entry);
    grouped.set(session.parentSessionId, siblings);
  }
  for (const siblings of grouped.values()) siblings.sort((a, b) => b.tokenTotal - a.tokenTotal);
  return grouped;
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
