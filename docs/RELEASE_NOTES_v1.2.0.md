# CC Token Meter v1.2.0

Version 1.2.0 adds exact, local-only model and date exploration across the CLI,
authenticated localhost API, and Projects dashboard. It also strengthens
filtered-summary correctness, cross-platform review gates, and release
distribution without changing the product's privacy model.

## Highlights

- Filter summaries and exports by an exact Claude model identifier with
  `--model`, optionally combined with inclusive `--from`, `--to`, and
  `--project` filters.
- Explore Projects usage over all time, 7, 30, or 90 days, or a custom local
  date range, with a model selector populated from local history.
- Recalculate project, session, and branch attribution for the selected scope
  while keeping Overview, Live Session, Insights, and budget semantics
  unchanged.
- Preserve exact filtered accounting across recent per-message detail and
  compacted historical daily rollups.
- Keep explorer state in the localhost URL and clearly disclose fallback
  pricing estimates.
- Run the full Linux, macOS, and Windows packed-package matrix after a pull
  request leaves Draft, summarized by one stable `Compatibility gate`.

## Correctness and development quality

- Exact model matching is case-insensitive but never broadens ambiguous family
  strings into multiple model identifiers; unknown models return an empty
  scope.
- Scoped insights are invalidated when the local store revision or any date,
  project, or model filter changes.
- Same-size transcript replacements now refresh the live dashboard through a
  monotonic local-store revision.
- The rolling synthetic dashboard preview exercises the production date,
  project, and model filtering path without reading personal Claude Code data.
- Required CI validates workflow YAML and expressions with a
  checksum-verified actionlint binary.

## Security and privacy

The runtime contract remains unchanged:

- transcripts remain read-only input
- no prompts, tool output, usage data, or project paths are uploaded
- no telemetry or analytics
- no Anthropic API key or Anthropic API calls
- no external runtime requests
- dashboard binds only to `127.0.0.1`
- local API and SSE endpoints remain session-authenticated
- `open` remains the only direct production dependency

## Distribution

A maintainer-published stable GitHub Release triggers two isolated jobs:

- `cc-token-meter@1.2.0` on the public npm registry through trusted OIDC with
  provenance; and
- `@sabeekhann/cc-token-meter@1.2.0` on GitHub Packages through the
  short-lived repository token.

Pull requests and version commits do not publish either package.

## Upgrade

Run without installing:

```bash
npx --yes cc-token-meter@1.2.0
```

Or update a global installation:

```bash
npm install --global cc-token-meter@1.2.0
```

## Compatibility

- Requires Node.js 20 or newer.
- No intended breaking CLI changes; `--model` is additive.
- Existing valid v2/v3 local indexes and configuration remain compatible.
- Windows, macOS, and Linux remain supported.
