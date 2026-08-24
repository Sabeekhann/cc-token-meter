# Changelog

All notable changes to this project are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
