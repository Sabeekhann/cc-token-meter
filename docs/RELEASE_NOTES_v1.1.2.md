# Claude Code Token Meter v1.1.2

Version 1.1.2 is a licensing and release-alignment patch. It publishes the
current Apache-2.0 codebase to npm so the package metadata, bundled legal
files, and repository licensing are consistent.

## Apache-2.0 licensing

- The npm package now declares `Apache-2.0`.
- `LICENSE` contains the applied Apache 2.0 notice with
  `Copyright 2026 FiveNodes`.
- `NOTICE` is included in the published package.
- `REUSE.toml` is included for machine-readable licensing metadata across the
  remaining distributed project-owned source and dashboard assets.
- Key executable and local-server source files carry explicit
  `SPDX-License-Identifier: Apache-2.0` notices.

Previously distributed versions that were released under MIT remain available
under the MIT terms that accompanied those copies.

## Release alignment

This patch also carries forward the corrected packed-release lifecycle test for
the authenticated local dashboard introduced in v1.1.1. The lifecycle test now
establishes the local session cookie before exercising protected API routes.

## Security posture

The application security model remains unchanged from v1.1.1:

- dashboard bound only to `127.0.0.1`
- authenticated local API and SSE endpoints
- HttpOnly, SameSite=Strict session cookie
- loopback Host validation
- no telemetry or external runtime requests
- read-only handling of Claude Code transcript input

The repository continues to use CodeQL, gitleaks, npm dependency auditing, and
Corgea as development/repository security controls. Corgea is not bundled into
the npm runtime.

## Upgrade

Run without installing:

```bash
npx --yes cc-token-meter@1.1.2
```

Or update a global installation:

```bash
npm install --global cc-token-meter@1.1.2
```

## Compatibility

- Requires Node.js 20 or newer.
- No intended breaking CLI changes.
- Existing local usage indexes and configuration remain compatible.
