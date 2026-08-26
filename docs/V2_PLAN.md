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

The source adapter boundary keeps local-agent log schemas out of analytics.
Claude Code remains the supported source for the current product; additional
sources should be added only when they can preserve the same privacy and
reliability guarantees.

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

All five delivery phases have substantial implementations on `main`.

- **Phase 1 — accounting:** exact per-message attribution, date-aware pricing,
  fallback-price visibility, branch/session/project aggregation, live velocity,
  cache health, model mix, and data-quality summaries are implemented and
  regression-tested.
- **Phase 2 — local index:** the private v3 index uses atomic writes, warm-start
  offsets, bounded recent detail with exact daily rollups, v2-to-v3 migration,
  truncation recovery, corruption fallback, and `--no-cache` support.
- **Phase 3 — intelligence:** structured insight evidence/confidence, ranked
  recommendations, savings estimates where calculable, compact-session
  awareness, and bounded-history-aware heuristics are implemented.
- **Phase 4 — dashboard:** Overview, Live Session, Projects, Insights, and
  Settings are implemented with search/filtering, session navigation, local
  budget saving, responsive layouts, and explicit loading/empty/connection
  states.
- **Phase 5 — reliability/release:** `doctor`, date/project filters, compact
  summaries, JSON/CSV exports, release lifecycle checks, deterministic large-
  history benchmarks, PR governance, required CI, Corgea review, informational
  Codecov/dependency review, Security workflows, and npm trusted publishing are
  in place.

Compatibility currently covers Node 20, 22, 24, and 26 across Linux, macOS, and
Windows. Large-history budgets run on Node 20, 24, and 26. The shipped runtime
remains local-only and loopback-only, and the maintenance stack is reducing the
runtime dependency footprint to `open` only.

This document is now a product/architecture plan and status reference rather
than a description of a separate working branch. Future v2 work should be
tracked as focused issues/PRs against `main` and should preserve the constraints
above.

The detailed dashboard information architecture and interaction requirements
are maintained in [`UI_PLAN.md`](UI_PLAN.md).
