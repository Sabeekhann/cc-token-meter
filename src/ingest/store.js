import { discoverSessionFiles, deriveProjectPath } from './discover.js';
import { parseSessionFile } from './parser.js';
import { computeCost } from '../pricing/cost.js';

const REGLOB_INTERVAL_MS = 5000;
const TOOL_EVENT_RING_SIZE = 200;

/**
 * Create a new in-memory store instance. All state lives on the returned
 * object — no module-level singletons, so multiple stores (e.g. in tests)
 * don't collide.
 */
export function createStore() {
  /** @type {Map<string, SessionAggregate>} */
  const sessions = new Map();

  // filePath -> { offset, mtimeMs, size }
  const fileState = new Map();

  let lastRegLobTime = 0;
  let hasColdScanned = false;
  let totalIngestedMessages = 0; // cheap change-detection counter for SSE

  function getOrCreateSession(sessionId) {
    let agg = sessions.get(sessionId);
    if (!agg) {
      agg = {
        sessionId,
        projectCwd: null,
        projectDirNameFallback: null,
        models: new Set(),
        firstTimestamp: null,
        lastTimestamp: null,
        messageCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        cacheWrite5m: 0,
        cacheWrite1h: 0,
        costUsd: 0,
        estimatedCostUsed: false,
        gitBranch: null,
        version: null,
        toolEvents: [], // bounded ring buffer of tool-use/tool-result events
        // Per-message log, needed by heuristics/aggregation for
        // chronological/statistical analysis. Kept unbounded per-session
        // (sessions are bounded in message count in practice) — not
        // ring-buffered like toolEvents since heuristics need full history.
        usageRecords: [],
      };
      sessions.set(sessionId, agg);
    }
    return agg;
  }

  function pushToolEvent(agg, event) {
    agg.toolEvents.push(event);
    if (agg.toolEvents.length > TOOL_EVENT_RING_SIZE) {
      agg.toolEvents.shift();
    }
  }

  function applyParsedResults(filePath, projectDirName, result) {
    const { usageRecords, toolUseEvents, toolResultEvents } = result;

    for (const record of usageRecords) {
      const sessionId = record.sessionId || inferSessionIdFromFile(filePath);
      const agg = getOrCreateSession(sessionId);

      agg.projectCwd = record.projectCwd || agg.projectCwd;
      if (!agg.projectCwd) {
        agg.projectDirNameFallback = deriveProjectPath(projectDirName);
      }
      if (record.model) agg.models.add(record.model);
      if (record.gitBranch) agg.gitBranch = record.gitBranch;
      if (record.version) agg.version = record.version;

      if (record.timestamp) {
        if (!agg.firstTimestamp || record.timestamp < agg.firstTimestamp) {
          agg.firstTimestamp = record.timestamp;
        }
        if (!agg.lastTimestamp || record.timestamp > agg.lastTimestamp) {
          agg.lastTimestamp = record.timestamp;
        }
      }

      agg.messageCount += 1;
      agg.inputTokens += record.inputTokens;
      agg.outputTokens += record.outputTokens;
      agg.cacheCreationInputTokens += record.cacheCreationInputTokens;
      agg.cacheReadInputTokens += record.cacheReadInputTokens;
      agg.cacheWrite5m += record.cacheWrite5m;
      agg.cacheWrite1h += record.cacheWrite1h;

      const cost = computeCost(record);
      agg.costUsd += cost.totalCost;
      if (cost.estimated) agg.estimatedCostUsed = true;

      agg.usageRecords.push(record);
      totalIngestedMessages += 1;
    }

    for (const evt of toolUseEvents) {
      const sessionId = evt.sessionId || inferSessionIdFromFile(filePath);
      const agg = getOrCreateSession(sessionId);
      pushToolEvent(agg, { kind: 'tool_use', ...evt });
    }

    for (const evt of toolResultEvents) {
      // tool_result events don't carry a sessionId in the observed schema
      // (they live on `user` lines) — attach to the session inferred from
      // the file itself, since one session file = one sessionId. Also fall
      // back to associating with whichever session most recently had a
      // matching tool_use id, but that lookup is deferred to heuristics
      // (which receive the full toolEvents ring buffer already merged
      // per-session here).
      const sessionId = inferSessionIdFromFile(filePath);
      const agg = getOrCreateSession(sessionId);
      pushToolEvent(agg, { kind: 'tool_result', ...evt });
    }
  }

  function inferSessionIdFromFile(filePath) {
    const base = filePath.split('/').pop() || filePath;
    return base.replace(/\.jsonl$/, '');
  }

  /**
   * Cold-scan or incrementally tail all known session files. Safe to call
   * repeatedly on a poll interval.
   */
  async function ingestNewData() {
    const now = Date.now();

    let discovered;
    if (!hasColdScanned || now - lastRegLobTime > REGLOB_INTERVAL_MS) {
      discovered = await discoverSessionFiles();
      lastRegLobTime = now;
    } else {
      // Reuse previously discovered files (from fileState) without re-globbing.
      discovered = Array.from(fileState.keys()).map((filePath) => ({
        filePath,
        projectDirName: fileState.get(filePath).projectDirName,
      }));
    }

    for (const fileInfo of discovered) {
      const { filePath } = fileInfo;
      let projectDirName = fileInfo.projectDirName;

      let stat;
      try {
        const fs = await import('node:fs');
        stat = fs.statSync(filePath);
      } catch {
        continue; // file vanished
      }

      const prev = fileState.get(filePath);

      if (!prev) {
        // New file — cold scan it fully from offset 0.
        projectDirName = projectDirName || fileInfo.projectDirName;
        const result = await parseSessionFile(filePath, { startOffset: 0 });
        applyParsedResults(filePath, projectDirName, result);
        fileState.set(filePath, {
          offset: result.newOffset,
          mtimeMs: stat.mtimeMs,
          size: stat.size,
          projectDirName,
        });
        continue;
      }

      // Existing file — only tail if it changed since last check.
      if (stat.mtimeMs !== prev.mtimeMs || stat.size !== prev.size) {
        const result = await parseSessionFile(filePath, { startOffset: prev.offset });
        applyParsedResults(filePath, prev.projectDirName, result);
        fileState.set(filePath, {
          offset: result.newOffset,
          mtimeMs: stat.mtimeMs,
          size: stat.size,
          projectDirName: prev.projectDirName,
        });
      }
    }

    hasColdScanned = true;
    return { totalIngestedMessages };
  }

  function getSnapshot() {
    return {
      sessions: Array.from(sessions.values()).map((agg) => ({
        ...agg,
        models: Array.from(agg.models),
      })),
      totalIngestedMessages,
    };
  }

  return {
    ingestNewData,
    getSnapshot,
    // Exposed for tests / advanced callers.
    _internal: { sessions, fileState },
  };
}
