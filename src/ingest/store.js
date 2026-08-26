import { discoverSessionFiles, deriveProjectPath } from './discover.js';
import { parseSessionFile } from './parser.js';
import { computeCost } from '../pricing/cost.js';
import {
  DEFAULT_INDEX_FILE,
  readLocalIndexWithStatus,
  writeLocalIndex,
} from './localIndex.js';
import { compactSessionHistory } from './retention.js';

const REGLOB_INTERVAL_MS = 5000;
const TOOL_EVENT_RING_SIZE = 200;

/**
 * Create a new in-memory store instance. All state lives on the returned
 * object — no module-level singletons, so multiple stores (e.g. in tests)
 * don't collide.
 */
export function createStore({
  persistIndex = true,
  indexPath = DEFAULT_INDEX_FILE,
  discoverFiles = discoverSessionFiles,
  parseFile = parseSessionFile,
} = {}) {
  /** @type {Map<string, SessionAggregate>} */
  const sessions = new Map();

  // filePath -> { offset, mtimeMs, size }
  const fileState = new Map();

  let lastRegLobTime = 0;
  let hasColdScanned = false;
  let totalIngestedMessages = 0; // cheap change-detection counter for SSE

  restoreIndex();

  function restoreIndex() {
    if (!persistIndex || !indexPath) return;
    const restored = readLocalIndexWithStatus(indexPath);
    if (!restored) return;
    const { index } = restored;
    let compactedDuringRestore = false;

    for (const raw of index.sessions) {
      if (!raw || typeof raw.sessionId !== 'string') continue;
      const hydrated = {
        ...raw,
        models: new Set(Array.isArray(raw.models) ? raw.models : []),
        toolEvents: Array.isArray(raw.toolEvents) ? raw.toolEvents : [],
        dailyRollups: Array.isArray(raw.dailyRollups) ? raw.dailyRollups : [],
        usageRecords: Array.isArray(raw.usageRecords) ? raw.usageRecords : [],
      };
      const compacted = compactSessionHistory(hydrated);
      compactedDuringRestore ||= compacted.usageRecords.length !== hydrated.usageRecords.length;
      sessions.set(raw.sessionId, compacted);
    }

    for (const raw of index.files) {
      if (!raw || typeof raw.filePath !== 'string') continue;
      const { filePath, ...state } = raw;
      fileState.set(filePath, {
        ...state,
        sessionIds: Array.isArray(state.sessionIds) ? state.sessionIds : [],
      });
    }

    totalIngestedMessages = Array.from(sessions.values())
      .reduce((sum, session) => sum + (session.messageCount || 0), 0);
    const correctedMessageCount = totalIngestedMessages !== index.totalIngestedMessages;
    if (
      restored.migrated ||
      restored.sourcePath !== indexPath ||
      compactedDuringRestore ||
      correctedMessageCount
    ) persistCurrentIndex();
  }

  function persistCurrentIndex() {
    if (!persistIndex || !indexPath) return;
    writeLocalIndex(
      {
        totalIngestedMessages,
        sessions: Array.from(sessions.values()).map((session) => ({
          ...session,
          models: Array.from(session.models),
        })),
        files: Array.from(fileState.entries()).map(([filePath, state]) => ({
          filePath,
          ...state,
        })),
      },
      indexPath
    );
  }

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
        // Boolean only after ingestion has evidence for this session. An
        // absent value (for example, from a legacy warm index) means unknown.
        compactDetected: undefined,
        toolEvents: [], // bounded ring buffer of tool-use/tool-result events
        // Older exact counters are folded into dailyRollups; only a bounded
        // recent detail window remains for timelines and heuristics.
        dailyRollups: [],
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

  function applyParsedResults(filePath, projectDirName, result, compactDetectionState) {
    const { usageRecords, toolUseEvents, toolResultEvents } = result;
    const touchedSessionIds = new Set();

    for (const record of usageRecords) {
      const sessionId = record.sessionId || inferSessionIdFromFile(filePath);
      touchedSessionIds.add(sessionId);
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

      // Keep the exact, per-message accounting alongside the normalized
      // usage record. Downstream day/branch/model analytics can then
      // attribute cost correctly instead of spreading a session total
      // evenly across messages (which is wrong for mixed-model sessions).
      agg.usageRecords.push({
        ...record,
        costUsd: cost.totalCost,
        estimatedCostUsed: cost.estimated,
        costBreakdown: {
          inputCost: cost.inputCost,
          outputCost: cost.outputCost,
          cacheWrite5mCost: cost.cacheWrite5mCost,
          cacheWrite1hCost: cost.cacheWrite1hCost,
          cacheReadCost: cost.cacheReadCost,
        },
      });
      totalIngestedMessages += 1;
    }

    for (const evt of toolUseEvents) {
      const sessionId = evt.sessionId || inferSessionIdFromFile(filePath);
      touchedSessionIds.add(sessionId);
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
      touchedSessionIds.add(sessionId);
      const agg = getOrCreateSession(sessionId);
      pushToolEvent(agg, { kind: 'tool_result', ...evt });
    }

    // Full-scan evidence is carried forward at the file level across later
    // tails. Legacy indexes without that evidence remain unknown unless a
    // newly appended compact event provides a positive signal.
    if (typeof compactDetectionState === 'boolean') {
      for (const sessionId of touchedSessionIds) {
        const agg = getOrCreateSession(sessionId);
        agg.compactDetected = compactDetectionState;
      }
    }

    for (const sessionId of touchedSessionIds) {
      const session = sessions.get(sessionId);
      if (session) sessions.set(sessionId, compactSessionHistory(session));
    }

    return touchedSessionIds;
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
    let changed = false;
    let didDiscover = false;

    let discovered;
    if (!hasColdScanned || now - lastRegLobTime > REGLOB_INTERVAL_MS) {
      discovered = await discoverFiles();
      lastRegLobTime = now;
      didDiscover = true;
    } else {
      // Reuse previously discovered files (from fileState) without re-globbing.
      discovered = Array.from(fileState.keys()).map((filePath) => ({
        filePath,
        projectDirName: fileState.get(filePath).projectDirName,
      }));
    }

    if (didDiscover) {
      const discoveredPaths = new Set(discovered.map((item) => item.filePath));
      for (const [cachedPath, cachedState] of fileState.entries()) {
        if (discoveredPaths.has(cachedPath)) continue;
        removeSessionsForFile(cachedPath, cachedState);
        fileState.delete(cachedPath);
        changed = true;
      }
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
        const result = await parseFile(filePath, { startOffset: 0 });
        const compactDetected = mergeCompactDetection(undefined, result);
        const sessionIds = applyParsedResults(filePath, projectDirName, result, compactDetected);
        fileState.set(filePath, {
          offset: result.newOffset,
          mtimeMs: stat.mtimeMs,
          size: stat.size,
          projectDirName,
          sessionIds: Array.from(sessionIds),
          compactDetected,
          ...fileIdentity(stat),
        });
        changed = true;
        continue;
      }

      // Existing file — only tail if it changed since last check.
      if (
        stat.mtimeMs !== prev.mtimeMs ||
        stat.size !== prev.size ||
        fileIdentityChanged(prev, stat)
      ) {
        const replacedOrTruncated = stat.size < prev.offset || fileIdentityChanged(prev, stat);
        if (replacedOrTruncated) {
          removeSessionsForFile(filePath, prev);
        }

        const result = await parseFile(filePath, {
          startOffset: replacedOrTruncated ? 0 : prev.offset,
        });
        const compactDetected = mergeCompactDetection(
          replacedOrTruncated ? undefined : prev.compactDetected,
          result,
        );
        const touchedSessionIds = applyParsedResults(
          filePath,
          prev.projectDirName,
          result,
          compactDetected,
        );
        const sessionIds = replacedOrTruncated
          ? touchedSessionIds
          : new Set([...(prev.sessionIds || []), ...touchedSessionIds]);
        fileState.set(filePath, {
          offset: result.newOffset,
          mtimeMs: stat.mtimeMs,
          size: stat.size,
          projectDirName: prev.projectDirName,
          sessionIds: Array.from(sessionIds),
          compactDetected,
          ...fileIdentity(stat),
        });
        changed = true;
      }
    }

    hasColdScanned = true;
    if (changed) persistCurrentIndex();
    return { totalIngestedMessages };
  }

  function removeSessionsForFile(filePath, state) {
    const sessionIds =
      Array.isArray(state && state.sessionIds) && state.sessionIds.length > 0
        ? state.sessionIds
        : [inferSessionIdFromFile(filePath)];
    for (const sessionId of sessionIds) {
      const session = sessions.get(sessionId);
      if (session) {
        totalIngestedMessages = Math.max(0, totalIngestedMessages - (session.messageCount || 0));
        sessions.delete(sessionId);
      }
    }
  }

  function fileIdentity(stat) {
    return {
      dev: Number.isFinite(stat.dev) ? stat.dev : null,
      ino: Number.isFinite(stat.ino) ? stat.ino : null,
      birthtimeMs: Number.isFinite(stat.birthtimeMs) ? stat.birthtimeMs : null,
    };
  }

  function mergeCompactDetection(previousState, result) {
    if (result.compactDetected === true) return true;
    if (result.compactDetectionComplete === true) return false;
    return typeof previousState === 'boolean' ? previousState : undefined;
  }

  function fileIdentityChanged(previous, stat) {
    const current = fileIdentity(stat);
    if (previous.dev != null && current.dev != null && previous.dev !== current.dev) return true;
    if (previous.ino != null && current.ino != null && previous.ino !== current.ino) return true;
    return (
      previous.birthtimeMs != null &&
      current.birthtimeMs != null &&
      previous.birthtimeMs !== current.birthtimeMs
    );
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
