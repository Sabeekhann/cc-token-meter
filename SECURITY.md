# Security Policy

Claude Code Token Meter reads sensitive local development history, so privacy
and local-only behavior are security boundaries—not optional product details.

## Supported versions

Security fixes are made on `main` and released in the latest published version.
Older versions may not receive backports. Before reporting a problem, reproduce
it with the newest release or the current `main` branch when practical.

## Report a vulnerability privately

Do **not** open a public issue for a suspected vulnerability. Use GitHub's
[private vulnerability reporting form](https://github.com/Sabeekhann/cc-token-meter/security/advisories/new).

Include:

- the affected version or commit;
- the operating system and Node.js version;
- the security or privacy impact;
- minimal reproduction steps using synthetic data;
- a suggested fix, if known.

Never attach real Claude Code transcripts, prompts, model responses, tool
inputs or outputs, API keys, cookies, credentials, private project names, or
private file paths. Replace them with clearly synthetic values.

If the private form is unavailable, open a public issue containing only a
request for a private contact channel. Do not include vulnerability details.

## Security boundaries

Reports are especially useful when they involve:

- transcript, prompt, tool-output, or project-path disclosure;
- the dashboard listening beyond `127.0.0.1`;
- outbound telemetry, remote requests, or remote assets;
- unsafe file permissions or writes to Claude Code transcripts;
- path traversal, command execution, browser injection, or unsafe exports;
- package, dependency, workflow, or release supply-chain compromise.

The maintainer will coordinate validation, remediation, release timing, and
responsible disclosure through the private advisory.
