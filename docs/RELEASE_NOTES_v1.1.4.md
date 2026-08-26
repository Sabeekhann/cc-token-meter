# CC Token Meter v1.1.4

Version 1.1.4 is a maintenance and correctness release that tightens model pricing, CSV safety, budget validation, CLI behavior, CI security boundaries, compatibility coverage, and the production dependency footprint without changing the local-only privacy model.

## Highlights

- Correct Claude model identifier matching for current and historical pricing families.
- Safer CSV exports that neutralize spreadsheet-formula prefixes.
- Centralized budget/config validation with safe stored-config recovery and atomic writes.
- Unknown CLI arguments now fail fast instead of being silently ignored.
- Native filesystem transcript discovery replaces the `glob` runtime dependency.
- Node.js 26 joins the compatibility matrix while Node.js 20 remains supported.
- Codecov OIDC permissions are isolated from Required CI.
- Advisory dependency review is available on pull requests.
- Repository policy explicitly enforces the no-outbound-runtime-network boundary.

## Smaller runtime dependency surface

`open` is now the only direct production dependency. Transcript discovery uses built-in Node.js filesystem APIs while preserving the existing one-level Claude Code transcript layout, `.jsonl` filtering, deterministic ordering, and cross-platform path handling.

## Security and privacy

The runtime model remains unchanged:

- transcripts are read-only input
- no prompts, tool output, usage data, or project paths are uploaded
- no telemetry or analytics
- no Anthropic API key or Anthropic API calls
- no external runtime requests
- dashboard binds only to `127.0.0.1`
- local API and SSE endpoints remain session-authenticated

Final post-merge validation on `main` passed Required CI, Coverage, Compatibility on Node 20/22/24/26, dependency auditing, gitleaks, and CodeQL. Corgea also reported no blocking rules violations on the release-preceding maintenance pull requests.

## Upgrade

Run without installing:

```bash
npx --yes cc-token-meter@1.1.4
```

Or update a global installation:

```bash
npm install --global cc-token-meter@1.1.4
```

## Compatibility

- Requires Node.js 20 or newer.
- No intended breaking CLI changes.
- Existing local usage indexes and valid configuration remain compatible.
- Windows, macOS, and Linux remain supported.
