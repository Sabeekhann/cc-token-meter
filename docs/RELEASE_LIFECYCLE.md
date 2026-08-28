# Packed release lifecycle

`npm run test:lifecycle` validates the package users actually install rather
than importing files from the checkout. It is intentionally a heavier
Compatibility check that stays skipped during draft iteration, then runs when
a pull request is ready for review and again after merge. The single fast
`Required CI` job verifies only the harness contract.

The lifecycle runner:

1. creates a temporary root whose path contains spaces;
2. writes only synthetic Claude Code JSONL, using the platform line ending;
3. runs `npm pack` and installs that tarball into a clean temporary project;
4. sets `CC_TOKEN_METER_HOME` so the installed binary cannot discover a
   contributor's real transcript or state directories;
5. blocks non-loopback `fetch`, HTTP(S), TCP, and TLS connections at runtime;
6. verifies `--doctor`, `--summary`, `--json`, CSV export, and the binary
   version from the installed artifact;
7. reinstalls over a warm v3 index/config and proves both valid files are
   preserved;
8. migrates a warm v2 index to bounded v3 state without changing totals;
9. proves malformed and unsupported indexes are rebuilt from the synthetic
   transcript; and
10. starts the installed dashboard, requests its summary over `127.0.0.1`, and
   verifies the packaged server source binds explicitly to that address.

The test never publishes, calls Anthropic, uses billing data, or reads
`~/.claude`. If a non-loopback runtime request is attempted, the injected
network guard fails the command and records the rejected destination.

Run it locally after `npm ci`:

```bash
npm run test:lifecycle
```
