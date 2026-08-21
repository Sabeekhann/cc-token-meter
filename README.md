# cc-token-meter

[![Tests](https://github.com/Sabeekhann/cc-token-meter/actions/workflows/tests.yml/badge.svg)](https://github.com/Sabeekhann/cc-token-meter/actions/workflows/tests.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](package.json)

> **A private, local usage cockpit for Claude Code.** Understand live token
> burn, estimated cost, cache efficiency, project/branch drivers, and the next
> action worth taking—without sending your transcripts anywhere.

A local-only CLI and web dashboard that turns Claude Code's existing session
transcripts into useful operational intelligence. It requires no API key,
makes no Anthropic API call, works retroactively, and keeps the original
transcripts strictly read-only.

## What makes it useful

- **See what is active now.** Track active sessions, recent tokens/minute,
  estimated cost/hour, models, branches, and message-level burn.
- **Understand the drivers.** Compare projects and branches using exact
  per-message token and estimated-cost attribution.
- **Measure cache effectiveness.** See cache reuse and the estimated input
  cost avoided through cache reads.
- **Act on evidence.** Review ranked recommendations for repeated reads,
  cache degradation, large tool output, long context, and outlier sessions.
- **Stay ahead of budgets.** Configure daily/session guardrails and see a
  rolling 30-day forecast.
- **Start quickly.** A private versioned index restores unchanged history
  without parsing every transcript again.

## Dashboard

The v2 interface is organized around five jobs:

| View | What it answers |
| --- | --- |
| Overview | What happened today, what is active, and what needs attention? |
| Live session | Where is the current session burning tokens and estimated cost? |
| Projects | Which projects, branches, and sessions drive usage? |
| Insights | What action could reduce waste, and what evidence supports it? |
| Settings | What budgets and local privacy controls are configured? |

The detailed UX specification is in [`docs/UI_PLAN.md`](docs/UI_PLAN.md).

## Quickstart

```bash
npx cc-token-meter
```

This starts a loopback-only web server (default port `4317`, or the next free
port), indexes local history, and opens the dashboard. Live updates arrive
through Server-Sent Events while Claude Code is running.

## What data it reads

`cc-token-meter` reads Claude Code's own session transcripts from:

```
~/.claude/projects/**/*.jsonl
```

These files are already written to disk by Claude Code during normal use —
this tool does not modify Claude Code's behavior in any way. Access is
**strictly read-only**: `cc-token-meter` never writes back to those
transcript files. It writes only its own files under:

```
~/.claude-token-meter/config.json
~/.claude-token-meter/usage-index-v2.json
```

The config stores optional budget caps. The versioned usage index makes warm
starts fast by caching normalized counters, timestamps, model/branch/project
metadata, and tool names/local file paths needed by the heuristics. It never
stores prompt text or tool-result content. The index is written atomically and
uses owner-only file permissions where supported. Pass `--no-cache` to avoid
reading or writing it; deleting the index is also safe because it is rebuilt
from the original read-only transcripts.

No transcript content, file paths, prompts, or any other data is ever sent
anywhere — there is no remote component, analytics SDK, CDN asset, or outbound
network request. The dashboard server listens on `127.0.0.1` only.

## CLI reference

```
cc-token-meter                          Start the dashboard server (default)
cc-token-meter --summary                Print a compact local usage summary, exit
cc-token-meter --json                   Load/index history, print JSON summary, exit
cc-token-meter --csv <path|->           Export filtered usage as CSV, exit
cc-token-meter --doctor                 Diagnose local setup and private state, exit
cc-token-meter --set-budget-usd <n>          Set daily cost cap (USD) and exit
cc-token-meter --set-budget-tokens <n>       Set daily token cap and exit
cc-token-meter --set-session-budget-usd <n>  Set per-session cost cap (USD) and exit
cc-token-meter --help                   Show help
cc-token-meter --version                Show version
```

Options:

```
--port <n>       Port to listen on (default: 4317, or next free port)
--no-open        Don't automatically open a browser window
--no-cache       Don't read or write the private local usage index
--from <date>    Include usage on/after local date YYYY-MM-DD (summary/JSON/CSV)
--to <date>      Include usage on/before local date YYYY-MM-DD (summary/JSON/CSV)
--project <text> Filter project paths by case-insensitive substring (summary/JSON/CSV)
--group-by <n>   CSV rows: day, project, branch, or session (default: day)
```

Examples:

```bash
npx cc-token-meter
npx cc-token-meter --port 5000 --no-open
npx cc-token-meter --summary
npx cc-token-meter --summary --from 2026-08-01 --project my-app
npx cc-token-meter --json
npx cc-token-meter --json --from 2026-08-01 --project my-app
npx cc-token-meter --csv usage.csv --group-by project
npx cc-token-meter --csv - --from 2026-08-01 --to 2026-08-31 --group-by day
npx cc-token-meter --doctor
npx cc-token-meter --doctor --json
npx cc-token-meter --no-cache
npx cc-token-meter --set-budget-usd 20
```

The `--summary` mode is the fastest terminal view: it reports selected and
today totals, active burn rate, cache reuse, top project, recommendation
count, and pricing-match quality. The `--json` mode is useful for scripting or
CI-adjacent local checks—it loads the local index, tails changed transcripts,
and prints a JSON summary
(today's totals, all-time totals, per-project/per-session breakdowns,
intelligence, and active tips) to stdout, then exits without starting a
server. Pass `--no-cache` when you specifically want an uncached full scan.
Date filters are inclusive local calendar dates. CSV exports are written
atomically with owner-only permissions where supported; use `--csv -` to
write CSV to stdout. `--doctor` checks the Node runtime, transcript access,
index/config health, and local-state permissions without changing transcript
files.

## Pricing disclaimer

Cost estimates are based on a locally-maintained pricing table
(`src/pricing/models.js`) that may lag official Anthropic pricing,
especially around scheduled price changes. Always treat dollar figures in
this tool as **estimates**, not authoritative billing data. For current,
authoritative pricing, see:

https://platform.claude.com/docs/en/about-claude/pricing

If a model isn't recognized by the local pricing table, `cc-token-meter`
falls back to a default Sonnet-tier rate and marks the message/session as
estimated. The Live Session view surfaces whether fallback pricing was used;
the JSON summary exposes `estimatedCostUsed` for programmatic checks.

## Known limitations

- **The first uncached scan scales with transcript history volume.** Later
  starts restore the private local index and tail only changed files. Using
  `--no-cache`, deleting the index, changing its schema version, or recovering
  from corruption intentionally performs a full rebuild.
- **Project-path reconstruction is lossy for paths containing literal
  hyphens.** Claude Code sanitizes the absolute project path into a
  directory name by replacing `/` with `-`, which cannot be perfectly
  reversed if the original path itself contained a hyphen. `cc-token-meter`
  uses the `cwd` field recorded on parsed transcript lines as the
  authoritative project label whenever available, and only falls back to
  reversing the sanitized directory name when no lines have been parsed
  yet for a given project.
- **The long-session-without-compact heuristic's compact-detection logic
  is best-effort and unverified against a real `/compact`-containing
  transcript.** It checks for a `user`-type line starting with the literal
  text `/compact` and, as a looser secondary signal, any `system`-type
  line mentioning "compact" (case-insensitive). If you notice this
  heuristic firing on sessions where you did run `/compact`, that's a
  known gap — please file an issue with an anonymized snippet of the
  relevant transcript lines so the detection logic can be corrected.

## How it works (brief)

- `src/ingest/discover.js` finds all `~/.claude/projects/*/*.jsonl` files.
- `src/ingest/parser.js` stream-parses each file line-by-line (never
  loading a whole file into memory), tolerating malformed lines and
  in-progress trailing writes from live sessions.
- `src/ingest/store.js` maintains a per-session aggregate, restores a private
  versioned local index, and polls for new/changed files roughly every 1.5
  seconds.
- `src/analytics/overview.js` produces active-session, recent velocity, cache
  health, model mix, and data-quality intelligence from normalized records.
- `src/pricing/` computes estimated cost per message using a versioned,
  date-aware pricing table.
- `src/heuristics/` runs five independent, pure-function checks against
  each session's usage and tool-call history to surface actionable tips.
- `src/server/` serves a small JSON API (`/api/summary`, `/api/stream`
  via Server-Sent Events, `/api/budget`) plus the static dashboard in
  `public/`.

## Development

```bash
npm install
npm run ci
node bin/cc-token-meter.js --json
npm run preview:dashboard
```

`npm run ci` runs both the repository's product-policy checks and all unit/
contract tests. The policy gate verifies JavaScript syntax, the dependency
footprint, pure analytics boundaries, loopback-only serving, browser security
headers, and the dashboard's no-remote-assets/no-remote-requests promise.

`npm run preview:dashboard` starts a development server at
`http://127.0.0.1:4318` backed by clearly synthetic fixture data. It never
reads personal Claude Code transcripts and exists for UI development and
screenshot capture.

See `CONTRIBUTING.md` for details on updating pricing, running tests, and
adding new heuristics.

The product roadmap and UI specification are documented in
[`docs/V2_PLAN.md`](docs/V2_PLAN.md) and [`docs/UI_PLAN.md`](docs/UI_PLAN.md).

## Repository automation

The GitHub workflow is deliberately product-specific rather than a generic
collection of badges:

- **CI** runs the project policy, package dry-run, and test suite on supported
  Node versions across Linux, macOS, and Windows.
- **PR Governance** validates Conventional Commit titles and the PR template,
  applies area/size/readiness labels, and keeps one actionable bot comment up
  to date.
- **Security** runs a production dependency audit, CodeQL, and a
  checksum-verified gitleaks scan on PRs, `main`, and a weekly schedule.
- **Merge Conflicts** rejects accidentally committed conflict markers.
- **Dependabot** opens weekly npm and GitHub Actions update PRs.
- **Sabee's Bot** provides an optional, narrow AI architecture review after a
  PR leaves draft status; human review still owns correctness, security, test
  adequacy, and UX.

Repository-owner setup, required-check recommendations, permissions, and the
fork-safety model are documented in [`docs/CI.md`](docs/CI.md).

## License

MIT — see `LICENSE`.
