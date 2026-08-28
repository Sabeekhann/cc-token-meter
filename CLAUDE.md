# cc-token-meter — Project Context

Local-only CLI + web dashboard that parses Claude Code's own session
transcript files (`~/.claude/projects/**/*.jsonl`) to show token usage, cost
estimates, and actionable tips. No build step, no framework, no telemetry —
read this file before starting any development or design task in this repo.

## Stack

- **Node ESM** (`"type": "module"` in `package.json`), `engines.node >= 20`.
- **No build step, no framework.** Server is Node's built-in `http` with a
  tiny manual router. Dashboard is vanilla HTML/CSS/JS
  served as static files from `public/`.
- **Two runtime dependencies**: `glob` (cross-version-safe file globbing),
  `open` (cross-platform browser launch). Adding a third needs clear,
  stated justification — see `CONTRIBUTING.md`.
- **Tests**: `node --test test/*.test.js` (Node's built-in `node:test` +
  `node:assert`, no test framework dependency). Run the full local gate via
  `npm run ci` (`npm run check` + `npm test`).
- **CLI entry**: `bin/cc-token-meter.js`. Commands: default (start
  dashboard server), `--json` (restore/index, print summary, exit),
  `--summary` (compact human-readable usage), `--csv` (private filtered
  export), `--doctor` (local setup diagnostics),
  `--set-budget-usd`/`--set-budget-tokens`/`--set-session-budget-usd`,
  `--port`, `--no-open`, `--help`, `--version`.
- **100% local.** No outbound network calls other than serving the local
  dashboard itself. Never add analytics, telemetry, or phone-home checks.

## Architecture / module map

- `src/ingest/`
  - `discover.js` — `discoverSessionFiles()` globs
    `~/.claude/projects/*/*.jsonl` (via the `glob` dependency, `nodir:
    true` — a same-named sibling directory exists next to each `.jsonl`
    file, must not be picked up), returns `{sessionId, projectDirName,
    filePath, mtimeMs, size}[]`. Returns `[]` rather than throwing if the
    projects dir doesn't exist yet (fresh install). Also exports
    `deriveProjectPath(projectDirName)`, the lossy `-`→`/` reversal
    fallback described in Known Gaps below.
  - `parser.js` — stream-parses each file line-by-line (never loads a whole
    file into memory), tolerates malformed lines and in-progress trailing
    writes from live sessions, tracks byte offsets for incremental tailing
    so a poll tick only re-reads bytes appended since the last read.
  - `store.js` — maintains a `SessionAggregate` per session, restores and
    persists a versioned private local index, detects transcript
    truncation/replacement, and polls for new/changed files ~every 1.5s.
    Key fields: `sessionId`,
    `projectCwd`/`projectDirNameFallback`, `models[]`, `firstTimestamp`/
    `lastTimestamp`, `messageCount`, `inputTokens`/`outputTokens`/
    `cacheCreationInputTokens`/`cacheReadInputTokens`/`cacheWrite5m`/
    `cacheWrite1h`, `costUsd`, `estimatedCostUsed`, `compactDetected`
    (tri-state: boolean after a full scan, absent for legacy cache entries),
    `gitBranch` (last-seen session value), `version`, `usageRecords[]` (the
    newest 1,000 per session, with older detail compacted into metadata-only
    daily rollups while exact aggregate totals are preserved), and
    `toolEvents[]` (ring-buffered at 200).
  - `localIndex.js` — reads/writes
    `~/.claude-token-meter/usage-index-v3.json` atomically with owner-only
    permissions where supported. Corrupt/future-version indexes are ignored
    and rebuilt. It contains normalized counters/events and local paths
    needed for analytics, never prompt or tool-result content.
  - `aggregate.js` — pure functions: `tokenTotal(session)`,
    `aggregateByProject(sessions)`, exact per-message
    `aggregateByBranch(sessions)`, `aggregateByDay(sessions)` (already a
    full daily time series), `getTodayTotal(sessions)`, `localDateKey`.
- `src/analytics/overview.js` — pure active-session, recent velocity, cache
  health/savings, model-mix, and data-quality intelligence.
- `src/pricing/`
  - `models.js` — exports `PRICING_TABLE` (array of `{ id,
    matchSubstrings[], inputPerMTok, outputPerMTok, effectiveFrom,
    effectiveUntil }`, figures in USD per million tokens) plus
    `CACHE_WRITE_5M_MULTIPLIER` (1.25x base input), `CACHE_WRITE_1H_MULTIPLIER`
    (2.0x), `CACHE_READ_MULTIPLIER` (0.1x) — cache pricing is derived from
    each row's base input rate via these fixed multipliers, not hardcoded
    per row, unless a specific model actually breaks the pattern (none
    currently do). Matching is by **substring** against `message.model`
    (normalized/lowercased), not exact equality, since real model id
    strings carry dates/minor versions. The first row whose substring
    matches wins, so more-specific rows must be listed before general
    fallback rows. `effectiveFrom`/`effectiveUntil` (ISO dates, nullable)
    bound a row's applicability so historical costs stay accurate across a
    price change. Preserve old rows whenever a real price change occurs;
    do not encode announced changes until the official pricing page confirms
    they will take effect.
  - `cost.js` — computes estimated cost per message from the pricing table.
    Falls back to a default (Sonnet-tier) rate for unrecognized models and
    marks the result `estimated: true`/`usedFallback` — not currently
    surfaced visually per-row in the dashboard.
- `src/budget/`
  - `config.js` — `readConfig()`/`writeConfig(updates)`, reads/writes
    `~/.claude-token-meter/config.json`; transcript files are strictly
    read-only. Shape:
    `{ dailyTokenCap, dailyCostCapUsd, sessionTokenCap, sessionCostCapUsd,
    warnThresholdPct }`, all nullable except `warnThresholdPct` (default
    `80`). `readConfig()` never throws on a missing file or malformed JSON
    — falls back to defaults silently in both cases, since a corrupt local
    config file shouldn't crash the CLI/server.
  - `alerts.js` — pure function `computeAlerts(todayTotals,
    activeSessionTotals, config)` → alert list (`level: 'warning'|
    'exceeded'`, `message`).
- `src/cli/`
  - `index.js` — argv parsing/dispatch.
  - `commands/start.js` — starts the dashboard server (default command).
  - `commands/json.js` — restore/index + `buildSummary()` + JSON to stdout,
    no server (`--no-cache` forces an uncached scan).
  - `commands/summary.js` — compact human-readable totals, live burn, cache,
    project, recommendation, and pricing-quality summary.
  - `commands/csv.js` — private atomic CSV export grouped by day, project,
    branch, or session; supports the same date/project filters as JSON.
  - `commands/doctor.js` — checks runtime compatibility, transcript access,
    private index/config health, and local-state permissions.
  - `commands/setBudget.js` — handles the three `--set-*-budget-*` flags.
  - `commands/help.js` — `--help` output.
- `src/heuristics/` — 5 pure one-function-per-file tip generators, each
  `(sessionRecord, toolEvents, allSessionsHistory) => Tip[]`, where
  `Tip = { id, sessionId, severity, message }`:
  - `repeatedReads.js`, `cacheRatio.js`, `longSessionNoCompact.js`
    (uses the privacy-safe `compactDetected` aggregate populated during
    streaming ingestion, and stays silent when legacy cache data lacks that
    evidence), `outlierSessionTotal.js`,
    `largeToolResultSpike.js`.
  - `index.js` — `runHeuristics(sessionRecord, toolEvents,
    allSessionsHistory, rawLines?)` registers and runs all 5, with a
    per-session `Map` cache keyed on `(messageCount, toolEventCount)` to
    avoid recomputing for idle sessions on every ~1.5s poll tick.
    `clearHeuristicsCache()` exported for tests.
- `src/server/`
  - `routes.js` — exactly 2 HTTP routes: `GET /api/summary`,
    `POST /api/budget` (allowlisted keys only). SSE stream is a separate
    concern (see `sse.js`).
  - `summary.js` — `buildSummary(store)` composes the full API/SSE
    payload (`generatedAt`, `today`, `allTime`, `byProject`, `byBranch`,
    `byDay`, `forecast`, `intelligence`, `sessions`, `tips`, `alerts`,
    `config`, `totalIngestedMessages`). Reused
    **verbatim** by both the SSE dashboard stream and the `--json` CLI
    command — any shape change must stay consistent across both consumers.
    Note: `sessionSummaries` includes `gitBranch`/`version`/`tokenTotal` but
    **not** raw `usageRecords` — per-message data isn't exposed by
    `buildSummary()` today; consuming it would require extending this shape
    or adding a new field/endpoint.
  - `sse.js` — `GET /api/stream`, Server-Sent Events, push interval 1.5s,
    change-detection via `totalIngestedMessages` (skips a push if nothing
    changed since the last tick).
- `public/` — `dashboard.html`, `dashboard.css`, `dashboard.js` (vanilla,
  no framework). `dashboard.js` performs an initial `GET /api/summary`, then
  connects via `new EventSource('/api/stream')`. Only the active view is
  re-rendered on updates. Key pieces:
  - Five task views: Overview, Live Session, Projects, Insights, Settings.
  - `renderBurnChart()` and `renderSessionTimeline()` create accessible local
    SVG charts without a chart dependency.
  - `renderProjects()` supports search and expandable session details;
    `renderInsights()` ranks/filters evidence and deep-links to sessions.
  - The Settings form posts to `/api/budget`, then refetches `/api/summary`
    so config changes appear even when no transcript message changed.
  - `test/dashboard-demo-server.js` + `dashboard-sessions.js` provide a
    rolling synthetic UI preview through `npm run preview:dashboard`; they
    never read personal transcripts and exercise the real summary filters.
  - All dynamic text goes through `escapeHtml`/`escapeHtmlAttr` before
    `innerHTML` — keep doing this for any new dynamic content.
  - `dashboard.css` defines the offline system-font visual system: dark
    navigation rail, off-white workspace, coral usage/action accent, teal
    healthy/local/live state, blue comparison series, and amber/red warnings.
    Desktop, tablet, and mobile layouts are included.
- `docs/UI_PLAN.md` is the canonical information architecture, interaction,
  accessibility, privacy, and acceptance-criteria document for dashboard work.

## Testing

- Run via `npm test` → `node --test test/*.test.js`. No test framework
  dependency — `node:test` + `node:assert` only.
- Current test files include parser, aggregate, cost, heuristics, analytics,
  local index, store, and dashboard structure/offline-contract coverage.
- Fixtures live in `test/fixtures/*.jsonl`, hand-written to exercise
  specific behaviors: `simple-session.jsonl`, `multi-model-session.jsonl`,
  `malformed-lines.jsonl`, `partial-last-line.jsonl`. Check the comment at
  the top of the consuming test file before assuming what a fixture covers
  — don't add a new fixture file unless testing raw line-parsing behavior
  specifically; synthetic in-test data is usually enough for heuristic/
  aggregate logic.
- `cost.test.js` intentionally uses a fake/injected pricing table with round
  numbers so it doesn't need to change when real prices change — never
  hardcode real dollar amounts into test assertions.
- New heuristics need at least one true-positive and one true-negative
  fixture case in `test/heuristics.test.js`.

## Conventions (full detail in `CONTRIBUTING.md` — this is the condensed version)

- No framework, no build step, no bundler. Don't add Express/Fastify/React/
  a compiler step — the route surface and dashboard are intentionally tiny.
- Dependency-light — justify any new dependency; prefer ~20 lines of vanilla
  Node over adding one.
- Pure-function boundary: `src/analytics/*`, `src/heuristics/*`,
  `src/pricing/*`, `src/budget/alerts.js`, `src/ingest/aggregate.js` must
  stay free of `fs`/`http`/network I/O — data in, data out only.
- New heuristic = one pure function per file in `src/heuristics/`, signature
  `(sessionRecord, toolEvents, allSessionsHistory) => Tip[]`, registered in
  `runHeuristics()`, with at least one true-positive and one true-negative
  fixture test in `test/heuristics.test.js`. Message copy must be
  plain-language and actionable — say what happened, with real numbers, and
  suggest one concrete thing to try.
- Pricing changes use row-versioning (`effectiveFrom`/`effectiveUntil`), not
  in-place overwrites, to preserve historical cost accuracy. See
  `CONTRIBUTING.md` for the full procedure.
- File placement: runtime code belongs under `bin/`, `src/`, or `public/`;
  tests under `test/`; documentation under `docs/`; and repository automation
  under `.github/`. New top-level directories need a stated reason.
- Code style: ESM `import`/`export` only, no TypeScript, no JSDoc-to-types
  build step (plain JSDoc for docs is welcome), explicit/readable over
  clever — single-maintainer-friendly codebase.

## CLI reference (from `README.md`)

```
cc-token-meter                                Start the dashboard server (default)
cc-token-meter --summary                      Print a compact local usage summary, exit
cc-token-meter --json                         Load/index history, print JSON summary, exit
cc-token-meter --csv <path|->                 Export filtered usage as CSV, exit
cc-token-meter --doctor                       Diagnose local setup and private state, exit
cc-token-meter --set-budget-usd <n>           Set daily cost cap (USD) and exit
cc-token-meter --set-budget-tokens <n>        Set daily token cap and exit
cc-token-meter --set-session-budget-usd <n>   Set per-session cost cap (USD) and exit
cc-token-meter --help                         Show help
cc-token-meter --version                      Show version
```

Start-command options: `--port <n>` (default `4317`, or next free port),
`--no-open` (don't auto-launch a browser), `--no-cache` (ignore and do not
write the private usage index). `--json` restores/indexes history and prints
one JSON summary object (same shape as `buildSummary()`) to stdout, then
exits — no server started. `--from`/`--to` apply inclusive local calendar
dates and `--project` performs a case-insensitive project-path substring
match for summary/JSON/CSV. `--group-by` selects day/project/branch/session CSV rows.
Useful for scripting/CI-adjacent local checks.

## Security / data-handling posture

- Reads are strictly confined to `~/.claude/projects/**/*.jsonl` — never
  writes back to those transcript files under any circumstance.
- Tool-owned writes are confined to `~/.claude-token-meter/config.json`
  (budget caps) and `usage-index-v3.json` (normalized local usage metadata).
  The index contains paths but never prompt/tool-result content and can be
  disabled with `--no-cache`.
- No outbound network calls except serving the local dashboard itself — no
  analytics SDK, no update-check ping, no error-reporting service.
- The HTTP server binds only to `127.0.0.1`; dashboard assets are local and
  static responses include a restrictive Content Security Policy.
- No secrets/API keys used or stored anywhere in this codebase — it never
  calls the Anthropic API, it only reads already-written local transcript
  files.
- Dashboard `innerHTML` usage is always passed through `escapeHtml`/
  `escapeHtmlAttr` first (see `dashboard.js` above) — this is the one place
  client-side HTML-injection patterns are relevant on this project; keep
  that discipline for any new dynamic rendering.

## Known gaps (standing findings, not regressions)

- Pricing table can lag official Anthropic pricing around scheduled changes
  — treat dollar figures as estimates; `estimated`/`usedFallback` flags
  exist in the data model but aren't rendered visually per-row in the
  dashboard yet.
- The first uncached scan still scales with total transcript history volume;
  warm starts restore the bounded v3 local index. Each session retains its
  newest 1,000 normalized usage records while older detail is compacted into
  metadata-only daily rollups without changing aggregate totals.
- Project-path reconstruction is lossy for paths containing literal
  hyphens (Claude Code sanitizes `/` to `-`; `cwd` on parsed lines is the
  authoritative label when available, directory-name reversal is only a
  fallback).

## CI / review

- Open substantial work as a draft PR. Before marking it ready, complete the
  template, self-review, local validation, and requested changes.
- `.github/workflows/tests.yml` runs the Ubuntu/Node 24 `Required CI` gate
  on PRs, pushes to `main`, and manual dispatches. It covers project policy,
  checksum-verified workflow linting, tests, production audit, packaging, CLI
  smoke checks, conflict markers, and an informational Codecov upload through
  GitHub OIDC.
- `Corgea: Security Scan` is a separate required PR status reported by the
  Corgea GitHub App. It is not a step in Required CI.
- `.github/workflows/pr-governance.yml` uses trusted base-branch code on
  `pull_request_target` to validate titles/templates, apply labels, and update
  one bot comment without executing PR head code.
- `.github/workflows/compatibility.yml` stays skipped for draft PRs, then runs
  when a PR is ready, after pushes to `main`, or manually across Node 20/22/26
  on Linux and Node 24 on macOS/Windows. Its stable `Compatibility gate`,
  `Required CI`, and `Corgea: Security Scan` must pass before a normal merge.
- `.github/workflows/security.yml` runs after pushes to `main`, weekly, or
  manually with production dependency audit, CodeQL, and checksum-verified
  gitleaks.
- Publishing is separate from PR validation. A maintainer-published,
  non-prerelease GitHub Release triggers `.github/workflows/publish.yml`,
  which verifies the tag/version, reruns the local gate, and publishes to npm
  with trusted OIDC.
- No `vercel.json` or deployment pipeline exists; this is an npm package
  (`npx cc-token-meter`), not a hosted service.

## Package / publish facts

- `package.json`: `name: "cc-token-meter"`, `"private": false`, binary
  `./bin/cc-token-meter.js`, and package files `bin`, `src`, `public`,
  `README.md`, `LICENSE`, `NOTICE`, and `REUSE.toml`.
- License: Apache-2.0.
- The runtime requires no Anthropic API key and sends no telemetry. CI-only
  Codecov and Corgea integrations are repository services, not package runtime
  dependencies.
- `docs/CI.md` is the canonical source for PR gates, workflow permissions,
  post-merge validation, and npm trusted publishing.

## File layout

```
bin/                  CLI entry point (bin/cc-token-meter.js)
src/
  ingest/             discover.js, parser.js, store.js, aggregate.js
  pricing/            models.js, cost.js
  budget/             config.js, alerts.js
  heuristics/          5 pure tip generators + index.js registry
  server/             routes.js, summary.js, sse.js
  cli/                command handlers (incl. --json mode)
public/               dashboard.html, dashboard.css, dashboard.js
test/                 node:test files + test/fixtures/*.jsonl
.github/              workflows, PR/issue templates, Dependabot, policy scripts
CONTRIBUTING.md        full contributor guide (pricing updates, new heuristics, code style)
README.md             user-facing docs (quickstart, CLI reference, limitations)
```

## Operating rules for this repo

- Read this file before any development or design task — don't re-derive
  stack/architecture/conventions from scratch each time.
- New tasks are routed through the purpose-built sub-agents in
  `.claude/agents/` (`data-layer`, `heuristics-dev`, `dashboard-ui`,
  `architect`, `qa-tester`), each scoped to one part of the codebase.
- **Only invoke the agent(s) actually required for the task at hand** —
  never call an extra agent "just in case" to broaden coverage. A
  dashboard-only change stays in `dashboard-ui`; a heuristics-only change
  stays in `heuristics-dev`; don't fan out beyond what the task needs.
