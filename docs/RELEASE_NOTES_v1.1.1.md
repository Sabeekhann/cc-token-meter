# Claude Code Token Meter v1.1.1

Version 1.1.1 is a security-hardening patch for the local dashboard. It
preserves the existing CLI and analytics behavior while tightening the local
web security boundary.

## Security hardening

- Static dashboard files are now served from an explicit packaged-asset
  allowlist; request-controlled path text is never converted into a filesystem
  path.
- The dashboard creates a cryptographically random session token in memory for
  each server process.
- Local `/api/*` routes and the Server-Sent Events stream require the session
  cookie.
- The session cookie is `HttpOnly` and `SameSite=Strict`.
- Host validation accepts only `127.0.0.1` and `localhost`, complementing the
  existing loopback-only server binding.
- Regression tests cover traversal attempts, Host validation, authorization,
  and cookie flags.

## Security scanning

The repository is scanned with CodeQL, gitleaks, production dependency
auditing, and Corgea. After the dashboard hardening landed, a Corgea full scan
of `main` reported zero active findings across SAST, Logic & Auth, Secrets,
Dependencies, Container, and IaC scanners.

Scanner results are point-in-time signals rather than a guarantee that software
is vulnerability-free.

Corgea is used only for repository/development security scanning. It is not
bundled into the npm package, does not run in the CC Token Meter dashboard, and
does not change the product's no-telemetry/no-external-runtime-request posture.

## Upgrade

Run without installing:

```bash
npx --yes cc-token-meter@1.1.1
```

Or update a global installation:

```bash
npm install --global cc-token-meter@1.1.1
```

## Compatibility and privacy

- Requires Node.js 20 or newer.
- Reads Claude Code transcripts locally and treats them as read-only input.
- Makes no Anthropic API calls and sends no telemetry.
- Binds the dashboard only to the local loopback interface.
- Includes no breaking CLI changes.
