# Large-history performance and retention

The private index keeps exact session totals while bounding detailed history.
Each session retains its newest 1,000 normalized usage records. Older records
are compacted into deterministic daily buckets keyed by local date, branch,
model, and Claude Code version. These rollups contain counters and metadata
only—never prompts, tool input/output, usernames, or real project paths.

The compaction boundary does not change visible all-time, day, project,
branch, or session totals. Date-filtered exports, model mix, cache metrics, and
data-quality counts combine rollups with recent detail. Live velocity,
timelines, and heuristic samples intentionally use the bounded recent-detail
window.

## Reproducible benchmark

```bash
npm run benchmark:large
```

The fixture is deterministic: 50,000 synthetic assistant-usage messages in 20
sessions, four synthetic projects, two synthetic branches, and two model IDs.
It includes usage metadata only. The benchmark measures a cold scan, a warm
index restore, one-file incremental tail, peak heap growth, and the resulting
index size. A warm run must parse zero unchanged transcripts; the tail run must
parse exactly one.

| Metric | Budget |
| --- | ---: |
| Cold start | ≤ 15,000 ms |
| Warm start | ≤ 1,500 ms |
| One-file incremental tail | ≤ 1,000 ms |
| Peak heap growth | ≤ 256 MiB |
| Private index size | ≤ 24 MiB |

The limits are deliberately above normal developer-machine results so shared
CI variance does not create noise, while still catching unbounded-history or
full-reparse regressions. Compatibility enforces them on Node 20, Node 24, and
Node 26 after a PR leaves Draft and again after merge.
The JSON result includes the Node version, platform, fixture dimensions,
budgets, and measured values for comparison.

Override fixture dimensions for exploratory runs without changing the checked
defaults:

```bash
CC_TOKEN_METER_BENCHMARK_MESSAGES=100000 \
CC_TOKEN_METER_BENCHMARK_SESSIONS=40 \
npm run benchmark:large
```

## Index upgrade and recovery

Index schema v3 adds `dailyRollups` and bounded `usageRecords`. On first use it
loads an unchanged v2 index, compacts it in memory, recalculates the current
message count, and atomically writes `usage-index-v3.json`; transcripts do not
need to be reparsed. Corrupt, unsupported, deleted, replaced, or truncated
state falls back to the read-only transcripts without double counting.

Deleting `~/.claude-token-meter/usage-index-v3.json` is always safe: the next
cached run rebuilds it. `--no-cache` continues to read no index and write no
index; its full transcript scan still returns exact totals using the same
bounded in-memory representation.
