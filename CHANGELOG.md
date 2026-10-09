# Changelog

All notable changes to this project are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed

- Redesigned dashboard: brand gradient visual system with matching dark and
  light themes, larger type (nothing below 11px), glowing gradient charts, a
  five-step activity heatmap, an efficiency ring, ranking share bars, a
  dramatic Live session view with a context-window gauge, colour-coded what-if
  pricing, restyled insight cards, and sectioned settings with a notification
  toggle. Session spans of 48 hours or more now read as days and hours.
- README screenshots and product tour updated for the new design.

## [1.3.0] — 2026-10-09

Feature release that corrects token accounting, counts subagents, and adds
in-flow, plan-aware, and coaching features while staying local-only.

### Fixed

- **Token and cost totals were overcounted.** Current Claude Code versions
  write one API response as several transcript lines (one per content block),
  each repeating the response's full usage. Every line was counted, inflating
  tokens and estimated cost (2.36× on one real session). Usage is now counted
  once per response (`message.id` + `requestId`), including across incremental
  reads.
- **Subagent usage was missing.** Subagent transcripts in
  `<session>/subagents/agent-*.jsonl` were never read. They are now counted in
  every total and attributed to the session that started them.
- Local indexes from earlier versions are rebuilt once from transcripts so the
  corrected accounting applies to all history.

### Added

- Subagent attribution: usage by agent type, per-session subagent runs in Live
  session details, and session cost caps that include subagents.
- Tool attribution: calls and result size per tool, grouped by MCP server,
  kept per local day so date filters stay exact.
- `--summary` and `--json` include the attribution.
- Dashboard refresh: dark theme (follows the system or a manual toggle), a
  Ctrl/⌘+K command palette with `g`-key view shortcuts, metric sparklines, an
  hour-of-week activity heatmap, a live context-window gauge, and "≈ est."
  badges on rows priced with the fallback rate.
- `--statusline` prints one line for Claude Code's `statusLine` command
  (session and today's tokens and cost, cache reuse, budget share, and the
  5-hour window in plan mode). `--statusline-config` prints setup steps; the
  meter never edits Claude Code settings.
- Pro/Max plan mode (`--set-plan`): estimated 5-hour windows with time to
  reset and projected usage, recent windows, a rolling 7-day total, and
  API-equivalent value against the plan price. Limits are user-set
  (`--set-block-token-limit`, `--set-weekly-token-limit`) or compared with
  your own largest recent window; no subscription limits are guessed.
- What-if pricing: the same tokens repriced on other Claude models, overall
  and per project, in Projects, `--summary`, and `--json`.
- Budget and plan alerts on Overview, with opt-in desktop notifications from
  the open dashboard tab (once per alert and level per day).
- Insights can be snoozed (1 day or 1 week), dismissed, and restored. State
  is stored in `config.json` under a one-way hash of the insight id.
- Monthly budgets (`--set-monthly-budget-usd`, `--set-monthly-budget-tokens`)
  with month-to-date progress, a month-end projection, on-pace alerts, and a
  `--summary` Month line.
- Weekly efficiency score (0–100 from cache reuse, open recommendations, and
  long-session compaction) on Overview, and a weekly Markdown report
  (`--report <path|->`, `GET /api/report`) with project names pseudonymized
  unless `--show-names` is passed.

### Changed

- Local indexes now record an accounting revision. Indexes written by earlier
  versions are rebuilt once from transcripts on first start, so expect
  lower (corrected) totals and a one-time full scan.

## [1.2.0] — 2026-08-28

Feature release adding exact, local-only usage exploration by model and date,
with correctness and release-gate hardening.

### Added
- Add exact, case-insensitive model filtering to compact summaries, JSON/CSV
  exports, and the authenticated localhost summary API. Model filters compose
  with inclusive local-date and project filters.
- Add a Projects usage explorer with all-time, 7-day, 30-day, 90-day, and
  custom ranges; an exact model selector; scoped project/session/branch
  attribution; URL-preserved filter state; and explicit estimated-pricing
  disclosure.
- Publish future stable releases to GitHub Packages as
  `@sabeekhann/cc-token-meter` alongside the existing public npm package.

### Fixed
- Invalidate cached usage insights when local transcript data or the selected
  date, project, or model scope changes, preventing recommendations from a
  previous scope from appearing in filtered summaries.
- Refresh the live dashboard after same-size transcript replacements by using
  a monotonic local-store revision instead of message count alone.
- Include the active model filter in compact CLI summary scope labels.

### Changed
- Exercise date, project, and model filtering in the rolling synthetic
  dashboard preview through the production summary pipeline.
- Validate GitHub Actions workflows with checksum-verified actionlint.
- Run the packed-artifact operating-system/Node compatibility matrix after a
  pull request leaves Draft and summarize it through the stable
  `Compatibility gate` merge status.

### Security
- Preserve the read-only, loopback-only runtime: no transcript, prompt, tool
  output, project path, or usage upload; no telemetry or analytics; no
  Anthropic API call; and no new production dependency.

## [1.1.4] — 2026-08-26

Maintenance, correctness, security, and compatibility improvements following
v1.1.3.

### Fixed
- Align Claude model identifier matching with current canonical model IDs while
  preserving historical aliases and fallback behavior.
- Neutralize spreadsheet-formula prefixes in CSV exports before normal CSV
  quoting is applied.
- Validate budget/config updates consistently across CLI, stored config, and
  dashboard API paths; invalid values now fail safely instead of persisting.
- Reject unknown CLI flags and unexpected positional arguments instead of
  silently accepting mistyped commands.

### Changed
- Replace the `glob` runtime dependency with deterministic native filesystem
  transcript discovery; `open` is now the only production dependency.
- Normalize npm repository/bin metadata and strengthen release-package contract
  validation.
- Expand compatibility coverage to Node.js 26 while retaining Node.js 20 as
  the supported minimum.
- Isolate Codecov OIDC permissions from Required CI and add advisory dependency
  review for pull requests.
- Enforce the local-only runtime network boundary in repository policy checks.
- Remove the completed one-shot maintenance workflow and synchronize public and
  maintainer documentation with the current repository state.

### Security
- Preserve the loopback-only dashboard, authenticated local API/SSE boundary,
  no-telemetry policy, and no external runtime requests.
- Final post-merge validation passed Required CI, Coverage, Node 20/22/24/26
  compatibility, dependency audit, gitleaks, and CodeQL.

## [1.1.3] — 2026-08-26

Correctness patch for Claude Code compact-session detection, with stronger CI visibility.

### Fixed
- Detect explicit compact-boundary events, literal `/compact` commands, and
  Claude Code command-tag records during streaming ingestion.
- Preserve a privacy-safe tri-state compact signal across full scans and
  incremental updates so compacted sessions no longer receive false
  “long session without `/compact`” recommendations.
- Treat legacy cached sessions without compact evidence as unknown, preventing
  unsupported warnings until fresh evidence is available.

### Changed
- Added informational Codecov reporting to the required CI workflow using
  GitHub OIDC; coverage uploads and thresholds remain non-blocking.
- Added Product Hunt and Socket badges plus repository-maintenance automation.

## [1.1.2] — 2026-08-25

Licensing and release-alignment patch for the Apache-2.0 transition.

### Changed
- Relicensed CC Token Meter from the MIT License to the Apache License,
  Version 2.0 for distributions from this release onward.
- Added a `NOTICE` file and aligned npm package metadata and README licensing
  references with the `Apache-2.0` SPDX identifier.
- Added explicit `Copyright 2026 FiveNodes` attribution to the applied Apache
  license notice.
- Added SPDX headers to key shipped source files and `REUSE.toml` metadata for
  the remaining distributed project-owned source and dashboard assets.
- Included `LICENSE`, `NOTICE`, and `REUSE.toml` in the npm package contents.
- Previously distributed MIT-licensed versions remain available under the
  license terms that accompanied those copies.

### Fixed
- Updated the packed-release lifecycle test to establish the authenticated
  local dashboard session before exercising protected API routes, keeping the
  compatibility matrix aligned with the v1.1.1 security hardening.

## [1.1.1] — 2026-08-24

Security-hardening patch for the local dashboard and repository scanning.

### Security
- Replaced request-derived static-file paths with an explicit allowlist of
  packaged dashboard assets, removing the path-traversal data flow from the
  local web server.
- Added an in-memory cryptographically random dashboard session token and
  HttpOnly, SameSite=Strict cookie authentication for local API and
  Server-Sent Events endpoints.
- Added loopback Host validation to reduce DNS-rebinding exposure while
  retaining the existing `127.0.0.1` binding.
- Added regression coverage for traversal attempts, local Host validation,
  session authorization, and cookie security flags.
- Added Corgea repository scanning alongside CodeQL, gitleaks, and dependency
  auditing. The post-hardening Corgea full scan reported zero active findings.

## [1.1.0] — 2026-08-24

Backward-compatible intelligence, accessibility, performance, and release
reliability improvements.

### Added
- Standardized every recommendation around measured evidence, confidence,
  affected scope, a concrete action, and calculable savings, with deterministic
  ranking and deduplication.
- Added semantic landmarks, labeled controls, keyboard interactions, visible
  focus states, accessible target sizing, text alternatives for charts, and
  responsive coverage from 390 to 1,440 CSS pixels.
- Added a packed-artifact lifecycle gate covering clean installation, warm
  upgrade, v2 index migration, corrupt-index recovery, exports, and offline
  loopback dashboard operation.
- Added a deterministic 50,000-message benchmark with enforced cold-start,
  warm-start, incremental-tail, heap-growth, and private-index-size budgets.

### Changed
- Upgraded the private index to bounded v3 storage: each session keeps its
  newest 1,000 normalized usage records while older detail is compacted into
  metadata-only daily rollups.
- Preserved exact all-time, date, project, branch, session, model, cache, and
  export totals across compaction and automatic v2-to-v3 migration.
- Expanded post-merge compatibility coverage for the packaged release on
  Node.js 20, 22, and 24 across Linux, macOS, and Windows.

### Fixed
- Made npm lifecycle commands portable on Windows by running the npm CLI
  through the active Node.js executable.
- Made transcript discovery platform-neutral so Windows path separators,
  spaces, and literal glob metacharacters do not hide valid Claude Code
  sessions.

## [1.0.2] — 2026-08-24

Maintenance and discovery improvements following the first public npm
release.

### Changed
- Made the published npm package the primary quick-start path and documented
  global installation, upgrades, and removal.
- Added npm version/download badges and a reusable repository social-preview
  asset.
- Aligned the required GitHub Actions job name with the protected-branch
  ruleset.
- Updated the `open` browser-launch dependency from 10.2.0 to 11.0.1 while
  retaining the existing Node.js 20-or-newer requirement.

## [1.0.1] — 2026-08-24

Release hardening for secure, repeatable public npm distribution.

### Added
- Private vulnerability-reporting guidance and a Contributor Covenant code of
  conduct.
- A release-only npm publishing workflow using GitHub OIDC trusted publishing.
- Release tag/package version validation and documented first-release steps.
- Repository and support metadata for the npm package listing.
- Cross-platform line-ending rules for source and documentation files.

### Security
- Pinned CodeQL actions to the immutable v4.37.6 release commit.

## [1.0.0] — 2026-07-31

Initial public release.

### Added
- Streaming JSONL ingestion of `~/.claude/projects/**/*.jsonl` with live
  file-tailing (no polling of unchanged files).
- Cost estimation using published per-model pricing (input/output/cache
  write/cache read), with date-bounded rates for scheduled price changes.
- Heuristics engine flagging five token-wasting patterns: repeated file
  reads without an intervening edit, cache-reuse ratio decay, long
  sessions without `/compact`, outlier session totals, and large
  tool-result → output spikes.
- Budget config (`~/.claude-token-meter/config.json`) with optional daily
  token/cost caps and a live gauge.
- Local web dashboard (SSE-driven, no build step) with per-project
  drill-down and expandable tip cards.
- CLI: default dashboard command, `--json` for a scriptable one-shot
  summary, `--set-budget-usd` / `--set-budget-tokens` /
  `--set-session-budget-usd`, `--port`, `--no-open`.
- Test suite (`node --test`) covering the parser, aggregator, cost module,
  and all five heuristics.
