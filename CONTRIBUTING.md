# Contributing to Claude Code Token Meter

Thank you for helping make Claude Code Token Meter more useful, trustworthy, and easy to use. Contributions are welcome from first-time contributors and experienced maintainers alike.

This guide is the contract for changes in this repository. The short version is: keep the product **local-only**, protect user data, prefer focused changes, and include real evidence that the change works.

## Contents

- [Ways to contribute](#ways-to-contribute)
- [Before you start](#before-you-start)
- [Project principles](#project-principles)
- [Development setup](#development-setup)
- [Project structure](#project-structure)
- [Making a change](#making-a-change)
- [Contribution guides](#contribution-guides)
- [Testing](#testing)
- [Pull requests](#pull-requests)
- [Privacy and security](#privacy-and-security)
- [Review process](#review-process)

Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md). Report
security vulnerabilities through the private process in [SECURITY.md](SECURITY.md),
not through a public issue.

## Ways to contribute

Useful contributions include:

- reproducible bug reports and focused fixes;
- tests for uncovered parser, pricing, analytics, and heuristic behavior;
- verified Anthropic pricing-table updates;
- new evidence-backed waste-reduction heuristics;
- accessibility, responsiveness, and dashboard usability improvements;
- performance work for large transcript histories;
- clearer documentation and examples;
- security hardening that preserves the local-only architecture.

If you are new to the project, a documentation fix, targeted regression test, or small UI accessibility improvement is a good place to begin.

## Before you start

Use this guide to avoid spending time on a change that does not fit the project.

| Change | Start coding? |
| --- | --- |
| Typo or small documentation correction | Yes. |
| Reproducible bug fix with a focused scope | Yes; link an issue when one exists. |
| Regression or coverage test | Yes. |
| Verified update to existing pricing data | Yes; cite the official source in the PR. |
| New heuristic or substantial UI behavior | Open a feature issue first. |
| New dependency, architecture change, data-retention change, or workflow permission change | Get maintainer agreement in an issue before implementation. |

Search [existing issues](https://github.com/Sabeekhann/cc-token-meter/issues) before opening a new one. For substantial work, describe the user problem, proposed behavior, privacy impact, alternatives, and testing plan.

## Project principles

Every contribution must preserve these boundaries:

### Local and private

- Never upload transcripts, prompts, tool output, project paths, or usage data.
- Never add telemetry, analytics, remote fonts, CDN assets, update checks, or a cloud dependency.
- Keep the dashboard bound to loopback (`127.0.0.1`) only.
- Treat Claude Code transcript files as read-only.

### Small and dependency-light

- The CLI uses plain Node.js ESM.
- The server uses Node's built-in `http` module and a small router.
- The dashboard is vanilla HTML, CSS, and JavaScript with no build step.
- Do not add a frontend framework, bundler, or server framework.
- Propose any new runtime dependency before adding it. Prefer a clear small implementation using the platform.

### Pure logic where possible

Code in `src/analytics/`, `src/heuristics/`, `src/pricing/`, `src/budget/alerts.js`, and `src/ingest/aggregate.js` should remain deterministic and free of I/O. Pass plain data in and return plain data out.

### Evidence over claims

- Add regression tests for bugs.
- Add true-positive and true-negative tests for heuristics.
- Use synthetic data in tests, screenshots, and PR evidence.
- Do not mark a check complete unless you actually ran it.

## Development setup

Requirements:

- Node.js 20 or newer;
- npm;
- Git.

```bash
git clone https://github.com/Sabeekhann/cc-token-meter.git
cd cc-token-meter
npm ci
npm run ci
```

Run the synthetic dashboard during UI work:

```bash
npm run preview:dashboard
```

Then open `http://127.0.0.1:4318`. The preview does not read your personal Claude Code history.

To exercise the CLI against your own local data:

```bash
node bin/cc-token-meter.js --doctor
node bin/cc-token-meter.js --summary
node bin/cc-token-meter.js --json
```

Do not paste real transcript content into issues, tests, or pull requests.

## Project structure

| Path | Responsibility |
| --- | --- |
| `bin/` | CLI entry point and argument handling. |
| `src/ingest/` | Transcript discovery, streaming parsing, aggregation, and private index management. |
| `src/pricing/` | Date-aware model matching and estimated-cost calculation. |
| `src/analytics/` | Usage, activity, cache, project, and forecast intelligence. |
| `src/heuristics/` | Independent evidence-backed recommendation rules. |
| `src/budget/` | Budget configuration and alerts. |
| `src/server/` | Loopback HTTP API, SSE updates, and static dashboard serving. |
| `public/` | Framework-free dashboard HTML, CSS, and JavaScript. |
| `test/` | Node test suites and synthetic fixtures. |
| `.github/` | Issue forms, PR template, policy scripts, and automation. |
| `docs/` | Product, UI, and CI documentation and project assets. |

## Making a change

1. Fork the repository and create a focused branch from the latest `main`.
2. Use a descriptive branch name such as `fix/parser-trailing-line`, `feat/cache-insight`, or `docs/quick-start`.
3. Keep the diff limited to one problem or feature.
4. Add or update tests and documentation with the code.
5. Run the relevant checks locally.
6. Review the complete diff for sensitive data and unrelated files.
7. Open a draft pull request early for substantial work; mark it ready only when the evidence is complete.

## Contribution guides

### Fixing a bug

- Start with the smallest synthetic reproduction.
- Add a regression test that fails before the fix.
- Correct the root cause without weakening privacy or policy checks.
- Describe the previous behavior, expected behavior, and observed result in the PR.

### Updating pricing

Pricing lives in `src/pricing/models.js`.

1. Verify the change in [Anthropic's official pricing documentation](https://platform.claude.com/docs/en/about-claude/pricing). Do not rely on third-party summaries.
2. Preserve historical accuracy. For a dated change to an existing model, add a new row with `effectiveFrom` and close the old row with the matching `effectiveUntil` instead of overwriting history.
3. Keep `matchSubstrings` specific enough to avoid collisions between model families and versions.
4. Use the existing cache-price multipliers unless the official source confirms a model-specific exception.
5. Update the pricing table's “current as of” comment.
6. Include the official source URL and verification date in the PR.

Real pricing values do not belong in unit assertions. Pricing-logic tests use injected round-number tables so official price changes do not create unrelated failures.

### Adding a heuristic

Each heuristic is an independent pure function in `src/heuristics/`:

```js
export function myHeuristic(sessionRecord, toolEvents, allSessionsHistory) {
  return [];
}
```

The result is an array of tip objects shaped like `{ id, sessionId, severity, message }`.

1. Add one focused heuristic file with no file-system or network I/O.
2. Register it in `src/heuristics/index.js`.
3. Add at least one true-positive and one true-negative case in `test/heuristics.test.js`.
4. Use an ID that is stable and deterministic.
5. Make the message plain-language, numerical where useful, and actionable.
6. Explain false-positive risks and thresholds in the PR.

### Changing the dashboard

- Preserve the no-build-step, vanilla HTML/CSS/JavaScript architecture.
- Test with `npm run preview:dashboard`, which uses synthetic data.
- Keep every workflow usable with a keyboard and visible focus styles.
- Use semantic HTML, useful labels, sufficient contrast, and reduced-motion support where animation exists.
- Check narrow and wide layouts.
- Avoid remote fonts, images, scripts, CSS, analytics, and network requests.
- Update `docs/UI_PLAN.md` when navigation, information architecture, or product behavior changes.

### Changing ingestion or the private index

- Continue streaming JSONL input; do not load large histories fully into memory.
- Tolerate malformed lines and incomplete trailing writes from active sessions.
- Keep transcript access read-only.
- Treat index-schema changes as migrations: bump the version or provide an explicit compatibility path.
- Never store prompt text or tool-result content in the index.
- Test cold scans, warm restores, changed-file tails, truncation, and corruption recovery when applicable.

### Changing GitHub automation

- Use least-privilege workflow permissions.
- Pin third-party actions to immutable commit SHAs when required by project policy.
- Do not expose secrets to fork-authored code.
- Keep checks specific to this repository and document user-visible behavior in `docs/CI.md`.
- Test workflow scripts directly where possible before relying on a hosted run.

## Testing

The project uses Node's built-in `node:test` and `node:assert`.

Run the complete local gate:

```bash
npm run ci
```

Useful focused checks:

```bash
npm run check
npm test
node --test test/parser.test.js
node bin/cc-token-meter.js --doctor
npm run preview:dashboard
```

`npm run check` protects syntax, the dependency footprint, pure analytics boundaries, loopback-only serving, browser security headers, and the no-remote-assets/no-remote-requests promise.

For tests and fixtures:

- use synthetic values and paths;
- cover edge cases as well as the happy path;
- keep time-dependent tests deterministic;
- avoid platform-specific path assumptions unless the test covers them explicitly;
- never commit raw personal Claude Code transcripts.

## Pull requests

Use a Conventional Commit title, for example:

- `feat(dashboard): add cache health details`
- `fix(ingest): rebuild a truncated session`
- `docs(contributing): clarify pricing verification`
- `test(heuristics): cover repeated-read threshold`

Complete the pull request template with:

- the problem and why it matters;
- the exact changes;
- related issue(s);
- real commands and output from testing;
- runtime or UI proof where applicable;
- privacy, rollout, and rollback considerations;
- any checklist item that is intentionally not applicable.

Open substantial changes as draft pull requests. While the PR is a draft:

1. keep the diff focused and push follow-up corrections to the same branch;
2. review Required CI, PR Governance, and informational Codecov results;
3. address automated findings and human review comments;
4. perform a self-review and remove debugging or unrelated changes;
5. confirm the branch contains no sensitive data and run `npm run ci`;
6. check **This PR is ready for human review** in the PR body.

After marking the PR ready for review, do not merge until both required statuses
have passed:

```text
Required CI
Corgea: Security Scan
```

Codecov coverage remains advisory. Resolve every review conversation and obtain
the approval required by the `main` ruleset before a maintainer merges.

## Privacy and security

Never submit any of the following in a public issue, pull request, fixture, screenshot, or CI log:

- raw Claude Code transcripts;
- prompts or model responses;
- tool inputs or outputs;
- API keys, tokens, cookies, credentials, or environment dumps;
- private repository names, file paths, branch names, or client data.

Use synthetic replacements such as `/Users/example/projects/demo-app`, `feature/example`, and clearly fake token counts. If a screenshot is necessary, use the synthetic preview and inspect every visible field before uploading it.

If a proposed feature needs outbound networking, telemetry, transcript mutation, or remote storage, it does not fit the current product architecture and requires an explicit public design decision before code is written.

## Review process

Every pull request has two required merge-gate statuses. `Required CI` runs
project policy, tests, the production dependency audit, packaging, CLI smoke
behavior, and conflict-marker detection. `Corgea: Security Scan` is reported
independently by the Corgea GitHub App. Both must pass before merge.

Required CI also uploads a privacy-safe source coverage report to Codecov.
Codecov project and patch results are informational and do not replace either
required gate. PR Governance separately validates metadata and maintains
labels.

Cross-platform Compatibility, CodeQL, and full secret scanning run after merge,
on schedule, or manually so contributor feedback stays fast. These workflows
and automated services do not replace human review.

Publishing is not part of the pull-request path. Only a maintainer-created
GitHub Release can start the npm publishing workflow, and the release tag must
exactly match the version in `package.json`.

Maintainers review for:

- correctness and regression coverage;
- privacy and local-only guarantees;
- usability and accessibility;
- performance on large histories;
- dependency and maintenance cost;
- documentation accuracy;
- focused scope and a safe rollback path.

Reviews may request changes. Address each thread with a code change, evidence,
or a concise technical explanation. `main` is maintainer-owned through
`.github/CODEOWNERS`; once required checks pass, approval is recorded, and
feedback is resolved, only a maintainer decides whether and when to merge.

Thank you for contributing responsibly.
