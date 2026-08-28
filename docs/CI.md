# GitHub automation and repository setup

cc-token-meter's automation protects the product's defining constraints: it
must stay local-only, read-only toward Claude Code transcripts, dependency
light, cross-platform, and straightforward to review.

## What runs

| Automation | Trigger | Purpose |
| --- | --- | --- |
| CI / Required CI | PRs, pushes to `main`, manual | Ubuntu/Node 24 required gate: checksum-verified workflow linting, project policy, unit/contract tests, production audit, package dry-run, CLI smoke tests, and conflict-marker detection |
| Coverage (informational) | PRs, pushes to `main`, manual | Generates LCOV with Node's built-in coverage and uploads it to Codecov through OIDC; non-blocking |
| Dependency review (informational) | PRs | Reviews dependency diffs for high-severity findings; non-blocking |
| Corgea: Security Scan | Pull-request events handled by the Corgea GitHub App | Independent repository security review reported as a required PR status; not a GitHub Actions job |
| Compatibility / Compatibility gate | Ready-for-review PRs, pushes to `main`, manual | Node 20/22/26 on Linux and Node 24 on macOS/Windows; unit tests plus packed-artifact lifecycle, with large-history budgets on Node 20/24/26 and one stable gate result |
| PR Governance | PR metadata/activity | Conventional title and template validation, area/size/status labels, one updated bot comment |
| Security | Pushes to `main`, Mondays, manual | Production `npm audit`, CodeQL, and full-history gitleaks scan |
| Publish | Published, non-prerelease GitHub Releases; explicit maintainer dispatch | Re-validates the exact release commit, can create the GitHub Release from the current `main` SHA, publishes `cc-token-meter` to npm through trusted OIDC, and publishes `@sabeekhann/cc-token-meter` to GitHub Packages with the short-lived repository token |
| Dependabot | Weekly | npm and GitHub Actions update PRs |

GitHub-maintained actions are pinned to immutable release commit SHAs.
Dependabot proposes updates so reviewers can verify both the release tag and
replacement commit before merging. Downloaded release tools are pinned by
version and checksum and remain isolated from untrusted pull-request code.

Local equivalent for the Node/package checks:

```bash
npm ci
npm run ci
npm pack --dry-run
```

The separate Coverage job generates `lcov.info` from `src/**/*.js` with Node's
built-in test runner and uploads it to Codecov using GitHub OIDC. No Codecov
token, Jest, or coverage dependency is stored in the repository. Project and
patch coverage signals remain informational in `codecov.yml`; Codecov is not a
required merge status.

The required pull-request job intentionally excludes the heavier clean-install
lifecycle. Compatibility stays skipped while a PR is a draft, then runs after
the PR is marked ready for review, after merge to `main`, or when started
manually. It runs `npm run test:lifecycle` on every platform in its matrix and
reports the complete result through the stable `Compatibility gate` status.
That test packs the exact publishable artifact, installs it into a clean
project, exercises upgrade and recovery paths with synthetic data, blocks
non-loopback runtime networking, and starts the installed dashboard on
`127.0.0.1`. See
[`RELEASE_LIFECYCLE.md`](RELEASE_LIFECYCLE.md) for the full contract.
Node 20, Node 24, and Node 26 jobs also run `npm run benchmark:large`; its
deterministic fixture and thresholds are documented in
[`PERFORMANCE.md`](PERFORMANCE.md).

## Pull-request flow

1. Create a focused branch and open a draft PR.
2. Push corrections while Required CI, PR Governance, informational Coverage,
   informational Dependency Review, and Corgea provide early feedback.
   Compatibility remains skipped while the PR is a draft.
3. Complete the PR template and self-review, then mark the PR ready.
4. Wait for all required statuses to pass:

```text
Required CI              (GitHub Actions)
Compatibility gate       (GitHub Actions)
Corgea: Security Scan    (Corgea)
```

5. Resolve every review conversation.
6. A maintainer merges the PR.
7. Security and Compatibility validate `main` again; publishing remains a
   separate, maintainer-controlled GitHub Release action.

Corgea runs through its GitHub App and reports directly to the pull request. It
does not run inside `.github/workflows/tests.yml`. Codecov runs in the separate
Coverage job in that workflow and is deliberately non-blocking.

## One-time repository-owner setup

### 1. Workflow permissions

In **Settings → Actions → General → Workflow permissions**, allow read and
write permissions. Individual workflow jobs still declare least-privilege
permissions; this repository setting lets PR Governance create labels and
maintain its single comment.

PR Governance checks out only the trusted base commit and uses GitHub API
metadata for the PR title, body, and changed-file list.

### 2. Branch protection

`.github/CODEOWNERS` records repository ownership. When last verified, the
active **Protect main** ruleset targeted the default branch and enforced:

- a pull request before merging;
- one approving review;
- dismissal of stale approvals after new commits;
- Code Owner review required;
- resolution of all review conversations;
- `Required CI`, `Compatibility gate`, and `Corgea: Security Scan` as required
  statuses;
- blocked force pushes and branch deletion.

Require only the stable `Compatibility gate`, not every operating-system
matrix job.

The review requirements need a second eligible reviewer because GitHub does not
allow PR authors to approve their own work. In a solo-maintainer repository,
either keep those requirements and use the owner's pull-request-only bypass for
self-authored changes, or deliberately change the ruleset to zero required
approvals with Code Owner review disabled. Repository settings are not changed
by these workflow files.

Do not substitute similarly named checks or remove their integration sources.
Keep PR Governance, Coverage/Codecov, and Dependency Review advisory. Security
stays outside the pull-request path; Required CI already audits production
dependencies and Corgea supplies the required PR security review. Compatibility
joins the gate only after a PR leaves Draft, avoiding macOS/Windows runner use
during early iteration.

The repository owner remains in the ruleset bypass list with **Allow for pull
requests only**. Treat that as a recovery mechanism, not the normal merge path.
Normal merges should still wait for required checks and resolved feedback.

### 3. Recommended GitHub settings

- Enable private vulnerability reporting and Dependabot alerts.
- Enable secret scanning and push protection when available.
- Prefer squash merge when a single Conventional Commit title should represent
  a focused PR in release history.
- Leave automatic Dependabot merging disabled; a maintainer reviews dependency
  changes.
- Enable **Automatically delete head branches** so merged feature branches are
  removed without cleanup workflows or stale branch clutter.

### 4. Package publishing

The npm trusted publisher is configured for:

```text
GitHub owner: Sabeekhann
Repository: cc-token-meter
Workflow filename: publish.yml
Allowed action: npm publish
```

The publish workflow supports two maintainer-controlled entry points: a published,
non-prerelease GitHub Release, or an explicit `workflow_dispatch` carrying the
release tag and exact current `main` commit SHA. Manual dispatch validates the
SHA, tag/version/changelog/release-notes contract and existing release state before
it can create the GitHub Release. Registry jobs then re-run the local gate and are
idempotent for an already-published matching version, which makes failed-job retries
safe. The npm job publishes the unscoped public package with short-lived OIDC
authentication and no `NPM_TOKEN`. The GitHub Packages job temporarily scopes the
package name to `@sabeekhann/cc-token-meter` and publishes with the short-lived
repository `GITHUB_TOKEN`; it does not change committed npm metadata. Neither path
runs on pull requests. See [`RELEASING.md`](RELEASING.md) for the full procedure.

## Project policy gate

`.github/scripts/project-policy.mjs` runs without third-party tooling and
checks:

- JavaScript syntax across runtime, browser, test, and automation scripts;
- exactly the documented runtime dependency footprint (`open` only);
- no filesystem/network I/O in analytics, heuristics, pricing, alert, or
  aggregation modules;
- no outbound-network or subprocess primitives in shipped runtime code;
- no remote dashboard assets or non-local browser request targets;
- explicit `127.0.0.1` server binding and required browser security headers.

If a future design intentionally changes one of these boundaries, update the
implementation, policy, tests, contributor documentation, and PR rationale in
the same change. Do not bypass the check with an unexplained exception.

## PR Governance behavior

The governance bot is deterministic and tested in `test/governance.test.js`.
It validates the exact PR template, uses GitHub's Draft/Ready state as the
authoritative review-readiness signal, requires self-review once a PR is Ready,
skips human-template enforcement for bot accounts, and manages
only its own label namespaces:

```text
area:*
size:*
status:*
dependencies
documentation
tests
```

It never removes unrelated maintainer labels. Its comment includes a stable
HTML marker, so edits update one existing comment instead of creating bot noise
on every push.

## Why the PR path stays small

The required job intentionally runs on one Linux runner. It covers workflow
syntax and semantics, behavior, policy, package contents, the production
dependency footprint, command entry points, and committed conflict markers in
one result. Coverage and dependency-diff review remain advisory. The slower
platform matrix starts only when a PR is ready for review and reports one stable
gate; the heavier security workflow still runs on `main`, weekly, or manually.
