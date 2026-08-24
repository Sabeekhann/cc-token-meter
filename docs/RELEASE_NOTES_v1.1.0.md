# Claude Code Token Meter v1.1.0

Version 1.1.0 makes local usage intelligence more actionable, keeps large
histories bounded without changing totals, improves dashboard accessibility,
and hardens the package lifecycle across Windows, macOS, and Linux.

## Highlights

- Every recommendation now carries measured evidence, confidence, affected
  scope, a concrete next action, and estimated savings when calculable.
- Insight ranking and deduplication keep the highest-value actions prominent.
- The dashboard adds semantic landmarks, labeled controls, keyboard support,
  visible focus states, accessible target sizing, text chart summaries, and
  responsive layouts from mobile through desktop.
- Private index v3 retains the newest 1,000 normalized usage records per
  session and compacts older detail into metadata-only daily rollups while
  preserving exact totals, filters, and exports.
- Existing v2 indexes migrate automatically; corrupt, replaced, truncated, or
  unsupported state rebuilds safely from read-only local transcripts.
- A deterministic 50,000-message benchmark now enforces startup, incremental
  update, memory, and index-size budgets.
- Packed-release validation now covers clean install, warm upgrade, recovery,
  export, and offline loopback operation across the supported platform matrix.
- Windows npm invocation and transcript discovery are now platform-neutral.

## Upgrade

Run without installing:

```bash
npx --yes cc-token-meter@1.1.0
```

Or update a global installation:

```bash
npm install --global cc-token-meter@1.1.0
```

The first cached run upgrades a valid v2 private index to v3 automatically.
Deleting the private index remains safe; the next run rebuilds it from local
Claude Code transcripts.

## Compatibility and privacy

- Requires Node.js 20 or newer.
- Reads Claude Code transcripts locally and treats them as read-only input.
- Makes no Anthropic API calls and sends no telemetry.
- Binds the dashboard only to the local loopback interface.
- Includes no breaking CLI changes. Index migration is automatic.
