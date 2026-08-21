# Contributing to cc-token-meter

Thanks for considering a contribution. This project is intentionally small,
dependency-light, and has no build step — please keep contributions in that
spirit.

## Philosophy

- **No framework, no build step.** The CLI is plain Node.js (ESM), the
  server is Node's built-in `http` module with a tiny manual router, and
  the dashboard is vanilla HTML/CSS/JS served as static files. Please
  don't introduce a bundler, a frontend framework, or a web framework
  (Express, Fastify, etc.) — the route surface is intentionally tiny and
  doesn't need one.
- **Dependency-light.** Current runtime dependencies are `glob` (for
  cross-Node-version-safe file globbing) and `open` (for cross-platform
  browser launching). Think hard before adding a new one — if a feature
  can be done in ~20 lines of vanilla Node, prefer that over a dependency.
- **100% local, always.** This tool must never make an outbound network
  call other than what's needed to serve its own local dashboard. Don't
  add analytics, telemetry, or "phone home" update checks.
- **Pure functions where possible.** `src/analytics/`, `src/heuristics/`, `src/pricing/`,
  `src/budget/alerts.js`, and `src/ingest/aggregate.js` are all pure
  functions with no I/O — this makes them trivially testable and easy to
  reason about. New logic in these areas should follow the same pattern:
  take plain data in, return plain data out, no `fs`/`http` calls inside.

## Running tests

```bash
npm ci
npm run ci
```

`npm run ci` runs `npm run check` followed by `npm test`. The policy command
checks every JavaScript file for syntax errors and protects the project's
local-only, loopback, pure-module, and dependency-light boundaries. Run the
full command before requesting review.

Tests use Node's built-in `node:test` + `node:assert` — no test framework
dependency. Fixtures live in `test/fixtures/*.jsonl` and are hand-written
to exercise specific parser/heuristic behaviors (malformed lines, partial
trailing writes, multi-model sessions, etc.) — see the comments at the top
of each fixture-consuming test file for what each fixture is meant to
cover.

## Updating pricing (`src/pricing/models.js`)

This is the most likely contribution, since Anthropic updates model
pricing periodically. To update:

1. Verify the new pricing at
   https://platform.claude.com/docs/en/about-claude/pricing — don't trust
   third-party summaries.
2. If a price change for an *existing* model is confirmed on the official
   pricing page with a known effective date, don't just overwrite the row —
   add a **new row** with the new price and an `effectiveFrom` date, and set
   the old row's `effectiveUntil` to that same date. This preserves accurate
   historical cost calculations. Do not encode announced future pricing
   blindly: Anthropic cancelled Sonnet 5's previously planned 2026-09-01
   increase and made its launch rate permanent.
3. Cache pricing is derived from the base input rate via fixed
   multipliers (`CACHE_WRITE_5M_MULTIPLIER`, `CACHE_WRITE_1H_MULTIPLIER`,
   `CACHE_READ_MULTIPLIER`) rather than hardcoded per row. Only add a
   per-row override if you confirm a specific model actually breaks this
   pattern (none currently do).
4. Model matching is by **substring**, not exact string equality (real
   model id strings carry dates/minor versions that change over time).
   Keep `matchSubstrings` specific enough to avoid collisions with other
   rows (e.g. `'opus-4.5'` not just `'opus-4'` if there's also an
   `'opus-4.1'` row).
5. Update `test/cost.test.js` only if you're testing new *logic* (e.g. a
   new multiplier rule) — the existing tests intentionally use a
   fake/injected pricing table with round numbers so they don't need to
   change when real prices change. Don't hardcode real dollar amounts into
   test assertions.
6. Bump the "current as of" date in the comment at the top of
   `src/pricing/models.js`.

## Adding a new heuristic

Heuristics live in `src/heuristics/`, one pure function per file, following
this signature:

```js
export function myHeuristic(sessionRecord, toolEvents, allSessionsHistory) {
  // return an array of Tip objects, or [] if nothing to flag
  return [];
}
```

where a `Tip` is `{ id, sessionId, severity, message }`. Steps to add one:

1. Create `src/heuristics/myHeuristic.js` with a pure function — no `fs`,
   no `http`, just take the session/tool-event data already assembled by
   `src/ingest/store.js` and return tips.
2. Register it in `src/heuristics/index.js`'s `runHeuristics()` alongside
   the existing five.
3. Add a fixture-based test in `test/heuristics.test.js` with **at least
   one true-positive and one true-negative case** — synthetic tool-event
   or usage-record sequences are usually enough; you generally don't need
   a new `.jsonl` fixture file unless you're testing something about raw
   line parsing specifically.
4. Keep the message template plain-language and actionable — say what
   happened, with real numbers, and suggest one concrete thing to try.

## Code style

- ESM (`"type": "module"` in `package.json`) — use `import`/`export`, not
  `require`.
- No TypeScript, no JSDoc-to-types build step — plain JSDoc comments for
  documentation purposes only are welcome and encouraged, especially on
  exported functions.
- Prefer explicit, readable code over cleverness — this is a small,
  single-maintainer-friendly codebase.

## Pull requests

- Use a Conventional Commit PR title such as
  `feat(dashboard): add cache health detail` or
  `fix(ingest): rebuild a truncated session`.
- Fill in the pull request template with the problem, concrete changes, and
  real testing evidence. Draft PRs may leave the two Review Readiness boxes
  unchecked; check them before requesting human review.
- Never attach raw Claude Code transcripts, prompts, tool results, API keys,
  or private project paths to an issue or PR. Use synthetic fixtures or
  carefully redacted evidence.
- The PR Governance workflow applies area, size, and readiness labels and
  updates one bot comment. See `docs/CI.md` for all automated checks.
