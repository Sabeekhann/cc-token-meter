# CC Token Meter v1.3.0

Version 1.3.0 corrects token accounting, counts subagent usage, and adds
features that bring the meter into Claude Code itself, understand Pro and Max
subscriptions, and coach better usage habits. Everything still runs locally.

## Corrected totals

- Current Claude Code versions write one API response as several transcript
  lines, each repeating the response's full usage. Earlier versions counted
  every line, overstating tokens and estimated cost (2.36× on one real
  session). Usage is now counted once per response.
- Subagent transcripts (`<session>/subagents/agent-*.jsonl`) are now read,
  counted in every total, and attributed to the session that started them.
- The local index is rebuilt once from transcripts on first start, so the
  corrected accounting applies to all history. Expect lower totals than
  v1.2.0 reported, and a one-time full scan.

## Highlights

- **Claude Code status line.** `cc-token-meter --statusline` prints session
  and today's usage, cache reuse, budget share, and (in plan mode) the 5-hour
  window inside Claude Code. Run `cc-token-meter --statusline-config` for
  setup; the meter never edits Claude Code settings.
- **Pro and Max plan mode.** `--set-plan pro|max5x|max20x` adds estimated
  5-hour windows with time to reset and projected usage, a rolling 7-day
  total, and API-equivalent value against the plan price. Progress is
  measured against limits you set or your own largest recent window;
  Anthropic publishes no subscription token limits, so none are guessed.
- **Subagent and tool attribution.** Usage by subagent type, per-session
  subagent runs, and the tools and MCP servers returning the most data into
  context.
- **What-if model pricing.** See what the same tokens would cost on other
  Claude models, overall or per project.
- **Budgets and alerts.** Monthly cost and token budgets with month-end
  projections, an Overview alert strip, and opt-in desktop notifications
  from the open dashboard tab.
- **Insight management.** Snooze, dismiss, and restore recommendations.
- **Weekly efficiency score and report.** A 0–100 score built from cache
  reuse, open recommendations, and compaction, plus a Markdown weekly report
  (`--report`) that pseudonymizes project names by default.
- **Dashboard refresh.** Dark theme, Ctrl/⌘+K command palette and keyboard
  shortcuts, sparklines, an activity heatmap, a context-window gauge, and
  badges on fallback-priced rows.

## Security and privacy

The runtime contract remains unchanged:

- transcripts remain read-only input
- no prompts, tool output, usage data, or project paths are uploaded
- no telemetry or analytics
- no Anthropic API key or Anthropic API calls
- no external runtime requests
- dashboard binds only to `127.0.0.1`
- local API and SSE endpoints remain session-authenticated
- insight states are stored under one-way hashes, and subagent attribution
  keeps ids and types only, never prompt or report text
- `open` remains the only direct production dependency

## Distribution

A maintainer-published stable GitHub Release triggers two isolated jobs:

- `cc-token-meter@1.3.0` on the public npm registry through trusted OIDC with
  provenance; and
- `@sabeekhann/cc-token-meter@1.3.0` on GitHub Packages through the
  short-lived repository token.

Pull requests and version commits do not publish either package.

## Upgrade

Run without installing:

```bash
npx --yes cc-token-meter@1.3.0
```

Or update a global installation:

```bash
npm install --global cc-token-meter@1.3.0
```

## Compatibility

- Requires Node.js 20 or newer.
- No breaking CLI changes; all new flags are additive.
- Existing configuration remains compatible; new keys are optional.
- Local indexes from earlier versions are rebuilt once automatically.
- Windows, macOS, and Linux remain supported.
