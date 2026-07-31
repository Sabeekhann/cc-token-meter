/**
 * Pure roll-up functions over an array of session aggregates (as produced
 * by store.getSnapshot().sessions). These never mutate their inputs.
 */

function tokenTotal(s) {
  return (
    (s.inputTokens || 0) +
    (s.outputTokens || 0) +
    (s.cacheCreationInputTokens || 0) +
    (s.cacheReadInputTokens || 0)
  );
}

/**
 * Roll sessions up by project (projectCwd, falling back to
 * projectDirNameFallback when no cwd has been observed yet).
 *
 * @param {Array<object>} sessions
 * @returns {Array<{project: string, sessions: object[], inputTokens: number, outputTokens: number, cacheCreationInputTokens: number, cacheReadInputTokens: number, costUsd: number, tokenTotal: number}>}
 */
export function aggregateByProject(sessions) {
  const byProject = new Map();

  for (const s of sessions) {
    const project = s.projectCwd || s.projectDirNameFallback || 'unknown';
    let bucket = byProject.get(project);
    if (!bucket) {
      bucket = {
        project,
        sessions: [],
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        costUsd: 0,
        tokenTotal: 0,
      };
      byProject.set(project, bucket);
    }
    bucket.sessions.push(s);
    bucket.inputTokens += s.inputTokens || 0;
    bucket.outputTokens += s.outputTokens || 0;
    bucket.cacheCreationInputTokens += s.cacheCreationInputTokens || 0;
    bucket.cacheReadInputTokens += s.cacheReadInputTokens || 0;
    bucket.costUsd += s.costUsd || 0;
    bucket.tokenTotal += tokenTotal(s);
  }

  return Array.from(byProject.values()).sort((a, b) => b.tokenTotal - a.tokenTotal);
}

/**
 * Roll sessions up by git branch (last-seen value per session — gitBranch is
 * NOT tracked per-message, so a session that switches branches mid-way has
 * its whole cost attributed to whichever branch was last seen, not split
 * proportionally). Sessions with no observed branch are grouped under the
 * '(no branch)' bucket.
 *
 * @param {Array<object>} sessions
 * @returns {Array<{branch: string, sessions: object[], inputTokens: number, outputTokens: number, cacheCreationInputTokens: number, cacheReadInputTokens: number, costUsd: number, tokenTotal: number}>}
 */
export function aggregateByBranch(sessions) {
  const byBranch = new Map();

  for (const s of sessions) {
    const branch = s.gitBranch || '(no branch)';
    let bucket = byBranch.get(branch);
    if (!bucket) {
      bucket = {
        branch,
        sessions: [],
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        costUsd: 0,
        tokenTotal: 0,
      };
      byBranch.set(branch, bucket);
    }
    bucket.sessions.push(s);
    bucket.inputTokens += s.inputTokens || 0;
    bucket.outputTokens += s.outputTokens || 0;
    bucket.cacheCreationInputTokens += s.cacheCreationInputTokens || 0;
    bucket.cacheReadInputTokens += s.cacheReadInputTokens || 0;
    bucket.costUsd += s.costUsd || 0;
    bucket.tokenTotal += tokenTotal(s);
  }

  return Array.from(byBranch.values()).sort((a, b) => b.tokenTotal - a.tokenTotal);
}

/**
 * Local calendar date (YYYY-MM-DD) from an ISO timestamp string, using the
 * host machine's local timezone.
 */
function localDateKey(isoTimestamp) {
  const d = new Date(isoTimestamp);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Bucket usage by local calendar date. A session spanning midnight
 * contributes to both days PROPORTIONALLY BY MESSAGE — i.e. each individual
 * assistant message (usageRecord) is attributed to the local date of its
 * own timestamp, not the session's start/end date as a whole. This avoids
 * splitting a single message's token counts across two days.
 *
 * Sessions must carry a `usageRecords` array (as produced by store.js) for
 * this to be accurate; if absent, the whole session's totals are bucketed
 * under its lastTimestamp's date as a best-effort fallback.
 *
 * @param {Array<object>} sessions
 * @returns {Array<{date: string, inputTokens: number, outputTokens: number, cacheCreationInputTokens: number, cacheReadInputTokens: number, costUsd: number, tokenTotal: number, messageCount: number}>}
 */
export function aggregateByDay(sessions) {
  const byDay = new Map();

  function ensureBucket(date) {
    let bucket = byDay.get(date);
    if (!bucket) {
      bucket = {
        date,
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        costUsd: 0,
        tokenTotal: 0,
        messageCount: 0,
      };
      byDay.set(date, bucket);
    }
    return bucket;
  }

  for (const s of sessions) {
    if (Array.isArray(s.usageRecords) && s.usageRecords.length > 0) {
      for (const record of s.usageRecords) {
        if (!record.timestamp) continue;
        const date = localDateKey(record.timestamp);
        const bucket = ensureBucket(date);
        bucket.inputTokens += record.inputTokens || 0;
        bucket.outputTokens += record.outputTokens || 0;
        bucket.cacheCreationInputTokens += record.cacheCreationInputTokens || 0;
        bucket.cacheReadInputTokens += record.cacheReadInputTokens || 0;
        bucket.tokenTotal += tokenTotal(record);
        bucket.messageCount += 1;
        // Cost per-message isn't stored on the record itself in the store,
        // so approximate proportionally: session cost / session message
        // count. This keeps day totals consistent with session totals.
        const perMessageCost = s.messageCount > 0 ? s.costUsd / s.messageCount : 0;
        bucket.costUsd += perMessageCost;
      }
    } else if (s.lastTimestamp) {
      const date = localDateKey(s.lastTimestamp);
      const bucket = ensureBucket(date);
      bucket.inputTokens += s.inputTokens || 0;
      bucket.outputTokens += s.outputTokens || 0;
      bucket.cacheCreationInputTokens += s.cacheCreationInputTokens || 0;
      bucket.cacheReadInputTokens += s.cacheReadInputTokens || 0;
      bucket.costUsd += s.costUsd || 0;
      bucket.tokenTotal += tokenTotal(s);
      bucket.messageCount += s.messageCount || 0;
    }
  }

  return Array.from(byDay.values()).sort((a, b) => (a.date < b.date ? -1 : 1));
}

/**
 * Rolling total since local midnight (today only), computed by filtering
 * aggregateByDay's output down to today's bucket.
 *
 * @param {Array<object>} sessions
 * @returns {{date: string, inputTokens: number, outputTokens: number, cacheCreationInputTokens: number, cacheReadInputTokens: number, costUsd: number, tokenTotal: number, messageCount: number}}
 */
export function getTodayTotal(sessions) {
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const days = aggregateByDay(sessions);
  const found = days.find((d) => d.date === todayKey);
  return (
    found || {
      date: todayKey,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      costUsd: 0,
      tokenTotal: 0,
      messageCount: 0,
    }
  );
}

export { tokenTotal, localDateKey };
