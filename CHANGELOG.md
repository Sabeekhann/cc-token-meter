# Changelog

All notable changes to this project are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
