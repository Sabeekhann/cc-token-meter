# GitHub automation and repository setup

cc-token-meter's automation protects the product's defining constraints: it
must stay local-only, read-only toward Claude Code transcripts, dependency
light, cross-platform, and straightforward to review. The workflows borrow
useful governance patterns from larger repositories without copying checks
that do not fit this small Node.js CLI.

## What runs

| Automation | Trigger | Purpose |
| --- | --- | --- |
| CI / Required CI | PRs, pushes to `main`, manual | One Ubuntu/Node 24 gate: project policy, tests, informational Codecov coverage, production audit, package dry-run, CLI smoke tests, and conflict-marker detection |
| Corgea: Security Scan | Pull-request events handled by the Corgea GitHub App | Independent repository security review reported as a required PR status; it is not a GitHub Actions job |
| Compatibility | Pushes to `main`, manual | Node 20/22 on Linux and Node 24 on macOS/Windows; it runs unit tests plus the packed-artifact lifecycle, and enforces large-history budgets on Node 20/24; it has no pull-request trigger |
| PR Governance | PR metadata/activity | Conventional title and template validation, area/size/status labels, one updated bot comment |
| Security | Pushes to `main`, Mondays, manual | Production `npm audit`, CodeQL, and full-history gitleaks scan |
| Publish | Published, non-prerelease GitHub Releases | Re-validates the package and publishes to npm through trusted OIDC authentication |
| Dependabot | Weekly | npm and GitHub Actions update PRs |

GitHub-maintained actions are pinned to immutable release commit SHAs.
Dependabot proposes updates so reviewers can verify both the release tag and
replacement commit before merging. Downloaded release tools are pinned by
version and checksum and remain isolated from untrusted pull-request code.

Local equivalent:

```bash
npm ci
npm run ci
npm pack --dry-run
```

Required CI generates `lcov.info` from `src/**/*.js` with Node's built-in
test runner and uploads it to Codecov using GitHub OIDC. No Codecov token, Jest,
or coverage dependency is stored in the repository. Project and patch coverage
checks are informational signals in `codecov.yml`; Codecov is not a required
merge status.

The required pull-request job intentionally excludes the heavier clean-install
lifecycle. After merge (or when started manually), Compatibility runs
`npm run test:lifecycle` on every platform in its matrix. That test packs the
exact publishable artifact, installs it into a clean project, exercises upgrade
and recovery paths with synthetic data, blocks non-loopback runtime networking,
and starts the installed dashboard on `127.0.0.1`. See
[`RELEASE_LIFECYCLE.md`](RELEASE_LIFECYCLE.md) for the full contract.
Node 20 and Node 24 jobs also run `npm run benchmark:large`; its deterministic
fixture and thresholds are documented in [`PERFORMANCE.md`](PERFORMANCE.md).

## Pull-request flow

1. Create a focused branch and open a draft PR.
2. Push corrections to the same branch while Required CI, PR Governance, and
   informational Codecov reporting provide feedback.
3. Complete the PR template, self-review, local validation, and requested
   changes before marking the PR ready for review.
4. Wait for both `Required CI` and `Corgea: Security Scan` to pass.
5. Obtain the required approval and resolve every review conversation.
6. A maintainer merges the PR.
7. Security and Compatibility validate `main`; publishing remains a separate
   maintainer-controlled GitHub Release action.

Corgea runs through its GitHub App and reports directly to the pull request. It
does not run inside `.github/workflows/tests.yml`. Codecov is the opposite:
its report appears only after Required CI reaches the coverage upload step.

## One-time repository-owner setup

### 1. Workflow permissions

In **Settings → Actions → General → Workflow permissions**, allow read and
write permissions. The workflow files still declare least-privilege job
permissions; this repository setting only lets PR Governance create labels and
maintain its single comment.

PR Governance checks out only the trusted base commit and
uses GitHub API metadata for the PR title, body, and changed-file list.

### 2. Branch protection

`.github/CODEOWNERS` assigns the entire repository to `@Sabeekhann`. The
active **Protect main** branch ruleset targets the default branch and enforces:

- a pull request before merging;
- one approval and approval from Code Owners;
- dismissal of stale approvals when new commits are pushed;
- resolution of all review conversations;
- both required status checks listed below;
- blocked force pushes and branch deletion.

```text
Required CI              (GitHub Actions)
Corgea: Security Scan    (Corgea)
```

Do not substitute similarly named checks or remove their integration sources.
Keep PR Governance and Codecov advisory. Security and Compatibility run outside
the pull-request path, so contributor PRs do not wait on macOS, Windows,
CodeQL, or full-history gitleaks work.

The repository owner is currently present in the ruleset bypass list with
**Allow for pull requests only**. That preserves an explicit maintainer recovery
path but means the owner can choose to bypass the configured rules. Normal
merges should still wait for the documented checks, approval, and resolved
feedback.

For this personal-account repository, collaborators have write access and can
merge pull requests. To make merging maintainer-only, keep the collaborator
list limited to people who are maintainers; outside contributors can submit
fork pull requests without collaborator access. Repository settings—not a
workflow file—are the enforcement boundary for merge permission.

### 3. Recommended GitHub settings

- Enable private vulnerability reporting and Dependabot alerts.
- Enable secret scanning and push protection when available.
- Prefer squash merge so the Conventional Commit PR title becomes the clean
  commit/release-history entry.
- Leave automatic Dependabot merging disabled; the maintainer reviews and
  merges dependency changes.

### 4. npm trusted publisher

After the first manual npm publish creates the package, configure its trusted
publisher with these exact values:

```text
GitHub owner: Sabeekhann
Repository: cc-token-meter
Workflow filename: publish.yml
Allowed action: npm publish
```

The publish workflow runs only for a published, non-prerelease GitHub Release,
requires the release tag to equal `v<package.json version>`, repeats the full
local gate, and publishes with short-lived OIDC authentication. It contains no
`NPM_TOKEN` and does not run on pull requests. See
[`RELEASING.md`](RELEASING.md) for the first-release and rollback procedure.

## Project policy gate

`.github/scripts/project-policy.mjs` runs without third-party packages and
checks:

- JavaScript syntax across runtime, browser, test, and automation scripts;
- exactly the documented runtime dependency footprint (`glob` and `open`);
- no filesystem/network I/O in analytics, heuristics, pricing, alert, or
  aggregation modules;
- no remote dashboard assets or non-local browser API requests;
- explicit `127.0.0.1` server binding and required browser security headers.

If a future design intentionally changes one of these boundaries, update the
implementation, policy, tests, contributor documentation, and PR rationale in
the same change. Do not bypass the check with an unexplained exception.

## PR Governance behavior

The governance bot is deterministic and tested in `test/governance.test.js`.
It validates the exact PR template, accepts incomplete readiness only while a
PR is a draft, skips human-template enforcement for bot accounts, and manages
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
HTML marker, so edits update one existing comment instead of creating bot
noise on every push.

## Why the PR path stays small

The required job intentionally runs on one Linux runner. It covers behavior,
policy, package contents, the two production dependencies, command entry
points, and committed conflict markers in one result. The slower platform and
security jobs still run on every update to `main`, and can be started manually
before a high-risk merge. This keeps the normal contributor loop short without
removing post-merge compatibility or scheduled security coverage.
