<div align="center">
  <img src="docs/screenshot.png" alt="cc-token-meter dashboard" width="100%"/>
</div>

<br/>

<div align="center">

[![Tests](https://github.com/Sabeekhann/cc-token-meter/actions/workflows/tests.yml/badge.svg)](https://github.com/Sabeekhann/cc-token-meter/actions/workflows/tests.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-e8650a.svg?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-2e2e2e?style=flat-square)](package.json)

</div>

<br/>

**cc-token-meter** is a local-only CLI + web dashboard that reads Claude
Code's own session transcript files and gives you a live terminal-style
view of token usage, cost estimates, and actionable tips — entirely
offline, zero telemetry, no API keys.

*(Screenshot uses synthetic demo data — no real project names or usage
data are shown.)*

<br/>

## Features

**Usage & Cost**
- Today's tokens, all-time totals, session count, estimated cost — always
  at a glance, with a live gauge if you've set a daily cap
- Burn-rate forecasting — projected cost for the rest of the month based
  on your recent daily average, with an over-budget warning
- Per-project and per-git-branch cost/token breakdown (click a row to
  expand its sessions)

**Insights & Tips**
- Actionable tips flagged by five independent heuristics — repeated file
  reads, cache-reuse drop-off, long uncompacted sessions, unusually large
  sessions, large tool-result spikes
- Tips are grouped by project and always show their full message plus the
  exact session they came from, with an estimated $/token savings badge
  where computable
- Per-session burn timeline (SVG bar chart + cumulative-burn line + tool
  event markers)

**Dashboard**
- Model and date-range filters (Today / 7d / 30d / All time), computed
  client-side with no extra network calls
- Daily token usage chart (input/output bars + cost overlay line)
- Live updates via Server-Sent Events — no manual refresh needed

## Install

```bash
npx cc-token-meter
```

This starts a local web server (default port `4317`, or the next free
port) and opens the dashboard in your browser.

## Requirements

- Node.js 18+
- [Claude Code](https://claude.ai/code) installed and used at least once

`cc-token-meter` scans `~/.claude/projects/**/*.jsonl` — the same session
files Claude Code writes locally. No data ever leaves your machine.

## What data it reads

`cc-token-meter` reads Claude Code's own session transcripts from:

```
~/.claude/projects/**/*.jsonl
```

These files are already written to disk by Claude Code during normal use —
this tool does not modify Claude Code's behavior in any way. Access is
**strictly read-only**: `cc-token-meter` never writes back to those
transcript files. The only file it writes is its own local config, at:

```
~/.claude-token-meter/config.json
```

which stores your optional budget cap settings (see below).

No transcript content, file paths, prompts, or any other data is ever sent
anywhere — there is no server-side component, no analytics SDK, and no
outbound network requests other than loading fonts/assets already bundled
locally with the dashboard itself.

## CLI reference

```
cc-token-meter                          Start the dashboard server (default)
cc-token-meter --json                   Cold-scan history, print JSON summary, exit
cc-token-meter --set-budget-usd <n>          Set daily cost cap (USD) and exit
cc-token-meter --set-budget-tokens <n>       Set daily token cap and exit
cc-token-meter --set-session-budget-usd <n>  Set per-session cost cap (USD) and exit
cc-token-meter --help                   Show help
cc-token-meter --version                Show version
```

Options for the default (start) command:

```
--port <n>       Port to listen on (default: 4317, or next free port)
--no-open        Don't automatically open a browser window
```

Examples:

```bash
npx cc-token-meter
npx cc-token-meter --port 5000 --no-open
npx cc-token-meter --json
npx cc-token-meter --set-budget-usd 20
```

The `--json` mode is useful for scripting or CI-adjacent local checks — it
performs a full cold scan of your transcript history and prints a JSON
summary (today's totals, all-time totals, per-project/per-session
breakdowns, and active tips) to stdout, then exits without starting a
server.

## Pricing disclaimer

Cost estimates are based on a locally-maintained pricing table
(`src/pricing/models.js`) that may lag official Anthropic pricing,
especially around scheduled price changes. Always treat dollar figures in
this tool as **estimates**, not authoritative billing data. For current,
authoritative pricing, see:

https://platform.claude.com/docs/en/about-claude/pricing

If a model isn't recognized by the local pricing table, `cc-token-meter`
falls back to a default (Sonnet-tier) rate and marks the result as
estimated in the underlying data (surfaced as `estimated: true` /
`usedFallback` in the JSON output) — the dashboard doesn't currently
render this flag visually per-row, so treat any unfamiliar model name in
your usage as a signal to double check the pricing table.

## Known limitations

- **Cold-scan cost scales with total transcript history volume.** The
  first time `cc-token-meter` runs against a project directory with a lot
  of accumulated session history, the initial full parse of every
  `.jsonl` file can take noticeably longer than subsequent incremental
  polls (which only tail files that changed).
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
- `src/ingest/store.js` maintains an in-memory aggregate per session and
  polls for new/changed files roughly every 1.5 seconds.
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
npm test
node bin/cc-token-meter.js --json
```

See `CONTRIBUTING.md` for details on updating pricing, running tests, and
adding new heuristics.

## License

MIT — see `LICENSE`.
