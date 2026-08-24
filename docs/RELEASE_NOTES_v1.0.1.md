# Claude Code Token Meter v1.0.1

The first production-ready npm release of Claude Code Token Meter is now
available.

## Install and run

```bash
npx --yes cc-token-meter@latest
```

The command opens a private dashboard on your machine and analyzes the Claude
Code transcripts already stored under `~/.claude/projects`. No API key is
required, no transcript content is uploaded, and no telemetry is collected.

## What you get

- live token and estimated-cost visibility;
- project, branch, session, and model attribution;
- cache-efficiency signals and practical waste-reduction insights;
- local budgets, summaries, JSON/CSV exports, and setup diagnostics;
- a responsive web dashboard bound only to `127.0.0.1`.

## Release hardening

v1.0.1 adds secure npm publishing with GitHub OIDC provenance, validates the
release tag against the package version, strengthens repository governance and
community documentation, and keeps pull-request CI focused on one fast
required gate.

This release does not change the local-only architecture. Dollar values remain
estimates rather than an Anthropic bill.

Full changelog: [CHANGELOG.md](../CHANGELOG.md)
