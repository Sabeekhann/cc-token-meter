# cc-token-meter — Project Context

Local-only CLI + web dashboard that parses Claude Code's own session
transcript files (`~/.claude/projects/**/*.jsonl`) to show token usage, cost
estimates, and actionable tips. No build step, no framework, no telemetry —
read this file before starting any development or design task in this repo.

## Stack

- **Node ESM** (`"type": "module"` in `package.json`), `engines.node >= 18`.
- **No build step, no framework.** Server is Node's built-in `http` with a
  tiny manual router (4 routes total). Dashboard is vanilla HTML/CSS/JS
  served as static files from `public/`.
- **Two runtime dependencies**: `glob` (cross-version-safe file globbing),
  `open` (cross-platform browser launch). Adding a third needs clear,
  stated justification — see `CONTRIBUTING.md`.
- **Tests**: `node --test test/*.test.js` (Node's built-in `node:test` +
  `node:assert`, no test framework dependency). Run via `npm test`.
- **CLI entry**: `bin/cc-token-meter.js`. Commands: default (start
  dashboard server), `--json` (cold-scan, print summary, exit),
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
  - `store.js` — maintains an in-memory `SessionAggregate` per session,
    polls for new/changed files ~every 1.5s. Key fields: `sessionId`,
    `projectCwd`/`projectDirNameFallback`, `models[]`, `firstTimestamp`/
    `lastTimestamp`, `messageCount`, `inputTokens`/`outputTokens`/
    `cacheCreationInputTokens`/`cacheReadInputTokens`/`cacheWrite5m`/
    `cacheWrite1h`, `costUsd`, `estimatedCostUsed`, `gitBranch` (**last-seen
    value only — overwritten each record, not full per-record history**),
    `version`, `usageRecords[]` (unbounded, per-message timestamp+token
    data), `toolEvents[]` (ring-buffered at 200).
  - `aggregate.js` — pure functions: `tokenTotal(session)`,
    `aggregateByProject(sessions)`, `aggregateByDay(sessions)` (already a
    full daily time series), `getTodayTotal(sessions)`, `localDateKey`.
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
    price change — see the Sonnet 5 2026-09-01 change already encoded in
    the table for the pattern to copy.
  - `cost.js` — computes estimated cost per message from the pricing table.
    Falls back to a default (Sonnet-tier) rate for unrecognized models and
    marks the result `estimated: true`/`usedFallback` — not currently
    surfaced visually per-row in the dashboard.
- `src/budget/`
  - `config.js` — `readConfig()`/`writeConfig(updates)`, reads/writes
    `~/.claude-token-meter/config.json` (the only file this tool ever
    writes; transcript files are strictly read-only). Shape:
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
  - `commands/json.js` — cold-scan + `buildSummary()` + JSON to stdout, no
    server.
  - `commands/setBudget.js` — handles the three `--set-*-budget-*` flags.
  - `commands/help.js` — `--help` output.
- `src/heuristics/` — 5 pure one-function-per-file tip generators, each
  `(sessionRecord, toolEvents, allSessionsHistory) => Tip[]`, where
  `Tip = { id, sessionId, severity, message }`:
  - `repeatedReads.js`, `cacheRatio.js`, `longSessionNoCompact.js`
    (compact-detection is best-effort/unverified — checks for a `user`-type
    line starting with literal `/compact`, or loosely any `system`-type
    line mentioning "compact"), `outlierSessionTotal.js`,
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
    payload (`generatedAt`, `today`, `allTime`, `byProject`, `byDay`,
    `sessions`, `tips`, `alerts`, `config`, `totalIngestedMessages`). Reused
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
  no framework). `dashboard.js` connects via `new EventSource('/api/stream')`
  and does a **full re-render** of the whole UI on every message (~1.5s
  cadence) — no partial/diffed DOM updates currently. Key pieces:
  - `TIP_KINDS` maps tip `id` prefixes to `{icon, label}` (generic label
    only — the real `tip.message` is hidden in a tooltip/expand toggle).
  - `renderTips(tips)` — renders collapsed single-line pills; no severity
    visual hierarchy beyond a `.warn` class; the real `tip.message` is
    hidden in a tooltip/expand toggle (`expandedTips` map) rather than
    shown inline.
  - `renderProjects(byProject)` — has a working expand/collapse pattern
    (`expandedProjects` map) and cost-proportional bar width logic; reuse
    this interaction pattern rather than inventing a new one.
  - All dynamic text goes through `escapeHtml`/`escapeHtmlAttr` before
    `innerHTML` — keep doing this for any new dynamic content.
  - `dashboard.css` (471 lines) defines CSS custom properties on `:root`:
    `--bg`, `--bg-grain`, `--card`/`--card2`, `--border`/`--border2`,
    `--ink`, `--muted`, `--dim`, `--accent`/`--accent-dark`/`--accent-soft`/
    `--accent-soft2` (warm orange, `#D97757`/`#BF5B3F`), `--warn`
    (`#C98A2B`), `--danger` (`#C6544B`), `--ff` (Inter body font), `--fh`
    (Fraunces heading serif), `--mono`, `--shadow`/`--shadow-lg`. Light,
    warm paper-toned theme (not dark mode) — a subtle dot-grain
    `background-image` on `body`. Any new dashboard UI should reuse these
    tokens rather than introducing new hex values inline.

## Testing

- Run via `npm test` → `node --test test/*.test.js`. No test framework
  dependency — `node:test` + `node:assert` only.
- Current test files: `test/parser.test.js`, `test/aggregate.test.js`,
  `test/cost.test.js`, `test/heuristics.test.js`.
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
- Pure-function boundary: `src/heuristics/*`, `src/pricing/*`,
  `src/budget/alerts.js`, `src/ingest/aggregate.js` must stay free of
  `fs`/`http`/network I/O — data in, data out only.
- New heuristic = one pure function per file in `src/heuristics/`, signature
  `(sessionRecord, toolEvents, allSessionsHistory) => Tip[]`, registered in
  `runHeuristics()`, with at least one true-positive and one true-negative
  fixture test in `test/heuristics.test.js`. Message copy must be
  plain-language and actionable — say what happened, with real numbers, and
  suggest one concrete thing to try.
- Pricing changes use row-versioning (`effectiveFrom`/`effectiveUntil`), not
  in-place overwrites, to preserve historical cost accuracy. See
  `CONTRIBUTING.md` for the full procedure.
- File placement: new files belong under `bin/`, `src/`, `public/`, `test/`
  only, without a stated reason for anything else.
- Code style: ESM `import`/`export` only, no TypeScript, no JSDoc-to-types
  build step (plain JSDoc for docs is welcome), explicit/readable over
  clever — single-maintainer-friendly codebase.

## CLI reference (from `README.md`)

```
cc-token-meter                                Start the dashboard server (default)
cc-token-meter --json                         Cold-scan history, print JSON summary, exit
cc-token-meter --set-budget-usd <n>           Set daily cost cap (USD) and exit
cc-token-meter --set-budget-tokens <n>        Set daily token cap and exit
cc-token-meter --set-session-budget-usd <n>   Set per-session cost cap (USD) and exit
cc-token-meter --help                         Show help
cc-token-meter --version                      Show version
```

Start-command options: `--port <n>` (default `4317`, or next free port),
`--no-open` (don't auto-launch a browser). `--json` performs a full cold
scan and prints one JSON summary object (same shape as `buildSummary()`)
to stdout, then exits — no server started. Useful for scripting/CI-adjacent
local checks.

## Security / data-handling posture

- Reads are strictly confined to `~/.claude/projects/**/*.jsonl` — never
  writes back to those transcript files under any circumstance.
- The only file this tool ever writes is
  `~/.claude-token-meter/config.json` (budget cap settings).
- No outbound network calls except serving the local dashboard itself — no
  analytics SDK, no update-check ping, no error-reporting service.
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
- `longSessionNoCompact`'s compact-detection logic is best-effort/unverified
  against a real `/compact`-containing transcript.
- Cold-scan cost scales with total transcript history volume (first run
  against a large project can be noticeably slower than later incremental
  polls, which only tail changed files).
- Project-path reconstruction is lossy for paths containing literal
  hyphens (Claude Code sanitizes `/` to `-`; `cwd` on parsed lines is the
  authoritative label when available, directory-name reversal is only a
  fallback).

## CI / review

- `.github/workflows/sabees-bot-review.yml` runs an automated
  architect-level Claude review on every PR (`review-internal` for
  same-repo branches, `review-fork` gated behind the `external-pr-review`
  GitHub Environment for fork PRs). It checks structural conventions only —
  file placement, duplication, module/pure-function boundaries, dependency
  footprint — and is explicitly **not** a substitute for correctness,
  security, test-adequacy, or UX review.
- No `vercel.json`/deploy pipeline in this repo — it's an npm package
  (`npx cc-token-meter`), not a hosted service.

## Package / publish facts

- `package.json`: `name: "cc-token-meter"`, `"private": false` (published
  to npm, invoked via `npx cc-token-meter`), `bin: { "cc-token-meter":
  "./bin/cc-token-meter.js" }`, `files: ["bin", "src", "public",
  "README.md", "LICENSE"]` — `test/` and `CONTRIBUTING.md` are intentionally
  excluded from the published package.
- License: MIT.
- `.github/workflows/tests.yml` runs `npm test` on push/PR (separate from
  `sabees-bot-review.yml`, which is the architect-review bot).

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
.github/workflows/    sabees-bot-review.yml (architect-only PR review), tests.yml
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
