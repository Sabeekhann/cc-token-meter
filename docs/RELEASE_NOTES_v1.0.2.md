# Claude Code Token Meter v1.0.2

Version 1.0.2 is a maintenance and discovery release. It keeps the product's
local-only behavior unchanged while improving installation guidance,
repository presentation, CI alignment, and browser-launch compatibility.

## Highlights

- Makes the published npm package the primary quick-start path:

  ```bash
  npx --yes cc-token-meter@1.0.2
  ```

- Documents global installation, upgrades, and removal.
- Adds npm version/download badges and a reusable GitHub social-preview asset.
- Aligns the protected-branch status check with the `Required CI` job name.
- Updates `open` from 10.2.0 to 11.0.1 for current cross-platform browser
  launching while preserving the project's Node.js 20-or-newer baseline.

## Upgrade

Run without installing:

```bash
npx --yes cc-token-meter@1.0.2
```

Or update a global installation:

```bash
npm install --global cc-token-meter@1.0.2
```

## Compatibility and privacy

- Requires Node.js 20 or newer.
- Reads Claude Code transcripts locally and treats them as read-only input.
- Makes no Anthropic API calls and sends no telemetry.
- Binds the dashboard only to the local loopback interface.

There are no breaking CLI or data-format changes in this release.
