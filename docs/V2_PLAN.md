# cc-token-meter v2 — Local Usage Intelligence

## Product outcome

Turn cc-token-meter from a historical counter into a local operations console
for Claude Code. A useful answer should be available within a few seconds for
each of these questions:

1. What is active right now, and how quickly is it burning tokens and cost?
2. Which project, branch, session, model, or tool behavior caused the spend?
3. Is cache reuse healthy, or is context being rebuilt unnecessarily?
4. What can I change next, what evidence supports it, and what might it save?
5. Am I likely to cross a budget before the end of the day or month?

## Product constraints

- Local and offline: no telemetry, analytics, remote API, CDN asset, or update
  check.
- Read-only source access: Claude Code transcript files are never modified.
- Private by default: the HTTP server listens only on loopback and local state
  files use owner-only permissions where the platform supports them.
- Dependency-light: plain Node.js, vanilla HTML/CSS/JS, and no build step.
- Evidence before advice: every recommendation needs a trigger, measured
  evidence, confidence, a concrete action, and savings when calculable.
- Honest estimates: fallback pricing and incomplete attribution are visible.

## Architecture

```text
Claude JSONL transcripts (read-only)
  -> streaming parser and source diagnostics
  -> versioned private local index
  -> normalized per-message usage records
  -> pure analytics and recommendation engine
  -> small local JSON/SSE APIs
  -> vanilla local dashboard and CLI exports
```

The source adapter boundary should make future support for other local agent
logs possible without coupling their schemas to analytics. Claude Code remains
the only v2 source until its pipeline is reliable and documented.

## Delivery plan

### 1. Accurate accounting foundation

- Store exact per-message cost and fallback-pricing status.
- Attribute branch-switching sessions per message rather than to the last
  branch observed.
- Use exact daily cost instead of averaging a session total across messages.
- Produce live velocity, cache health, model mix, active-session, and data
  quality summaries.

Exit criteria: mixed-model and branch-switching fixtures reconcile to the
same totals at message, day, branch, session, and all-time levels.

### 2. Fast, durable local index

- Persist only normalized counters/events required for analytics—never prompt
  or tool-result content.
- Restore unchanged transcript offsets across restarts.
- Detect truncation/replacement and rebuild affected sessions without double
  counting.
- Write atomically, version the schema, tolerate corruption, and offer a
  no-cache mode.
- Replace unbounded detailed history with daily rollups plus a bounded recent
  window once benchmark fixtures define safe limits.

Exit criteria: a warm start does not parse unchanged transcripts, a corrupt
index self-recovers, and large-history memory/startup budgets are enforced.

### 3. Actionable intelligence engine

- Create a standard insight contract: severity, evidence, confidence, action,
  affected scope, estimated tokens, and estimated USD.
- Add context growth, cache-rebuild, output spike, repeated read, model-choice,
  session outlier, and budget-risk analyses.
- Rank and deduplicate insights so the dashboard shows the most valuable next
  actions rather than a wall of tips.
- Separate measured facts from heuristic estimates.

Exit criteria: every insight has positive/negative tests and can explain its
calculation in plain language.

### 4. Dashboard rebuild

- Overview: today, forecast, cache efficiency, top drivers, and recommended
  actions.
- Live Session: token velocity, cost velocity, context/cache trajectory, model
  changes, and correlated tool events.
- Projects: date-range filtering and project/branch/session comparisons.
- Insights: ranked evidence, savings, confidence, status, and dismissal.
- Settings: budgets, privacy/index status, pricing freshness, and diagnostics.
- Update only changed UI regions instead of rebuilding the full DOM on every
  SSE tick.

Exit criteria: the five product questions above are answerable on desktop and
mobile without opening raw JSON.

### 5. CLI, exports, reliability, and release

- Add `doctor`, date/project filters, compact terminal summaries, and CSV/JSON
  exports.
- Surface parser/index health and unknown model pricing.
- Add large synthetic history benchmarks, server/security tests, and API
  contract tests.
- Add release validation and documented upgrade/index-migration behavior.

Exit criteria: a clean install, warm upgrade, corrupt-index recovery, export,
and offline run are covered by automated checks.

## Current implementation status

- Phase 1 is implemented in the v2 working branch.
- Phase 2 has a working versioned index, atomic private writes, warm-start
  restore, truncation recovery, corruption fallback, and `--no-cache`.
- Phase 4 has a complete first implementation of the Overview, Live Session,
  Projects, Insights, and Settings views, including project search, filters,
  session navigation, local budget saving, responsive layouts, and explicit
  loading/empty/connection states.
- Phase 5 now has product-specific CI policy enforcement, Node 20/22/24 and
  Linux/macOS/Windows test coverage, package validation, PR governance,
  dependency/security scans, merge-marker protection, issue/PR templates, and
  Dependabot maintenance. It also includes `doctor`, inclusive date/project
  filters, pricing-freshness diagnostics, a compact terminal summary,
  machine-readable JSON diagnostics, and private CSV exports grouped by day,
  project, branch, or session.
- Bounded history compaction, benchmark thresholds, structured insight
  evidence/confidence, and automated release publishing remain open roadmap
  work.

The detailed dashboard information architecture and interaction requirements
are maintained in [`UI_PLAN.md`](UI_PLAN.md).
