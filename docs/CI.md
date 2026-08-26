# GitHub automation and repository setup

cc-token-meter's automation protects the product's defining constraints: it
must stay local-only, read-only toward Claude Code transcripts, dependency
light, cross-platform, and straightforward to review. The workflows borrow
useful governance patterns from larger repositories without copying checks
that do not fit this small Node.js CLI.

## What runs

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| CI / Required CI | PRs, pushes to `main`, manual | One Ubuntu/Node 24 gate: project policy, tests, informational Codecov coverage, production audit, package dry-run, CLI smoke tests, and conflict-marker detection |
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

Required CI also generates `lcov.info` from `src/**/*.js` with Node's built-in
test runner and uploads it to Codecov using GitHub OIDC. No Codecov token, Jest,
or coverage dependency is stored in the repository. Project and patch coverage
checks begin as informational signals in `codecov.yml`; maintainers can make
them blocking later after a stable baseline is established.

The required pull-request job intentionally excludes the heavier clean-install
lifecycle. After merge (or when started manually), Compatibility runs
`npm run test:lifecycle` on every platform in its matrix. That test packs the
exact publishable artifact, installs it into a clean project, exercises upgrade
and recovery paths with synthetic data, blocks non-loopback runtime networking,
and starts the installed dashboard on `127.0.0.1`. See
[`RELEASE_LIFECYCLE.md`](RELEASE_LIFECYCLE.md) for the full contract.
Node 20 and Node 24 jobs also run `npm run benchmark:large`; its deterministic
fixture and thresholds are documented in [`PERFORMANCE.md`](PERFORMANCE.md).

## One-time repository-owner setup

### 1. Workflow permissions

In **Settings → Actions → General → Workflow permissions**, allow read and
write permissions. The workflow files still declare least-privilege job
permissions; this repository setting only lets PR Governance create labels and
maintain its single comment.

PR Governance checks out only the trusted base commit and
uses GitHub API metadata for the PR title, body, and changed-file list.

### 2. Branch protection

`.github/CODEOWNERS` assigns the entire repository to `@Sabeekhann`. The file
requests the right reviewer, but GitHub does not enforce that ownership until
`main` has a protection rule or branch ruleset with code-owner review enabled.

In **Settings → Rules → Rulesets**, create an active branch ruleset targeting
the default branch. Configure it as follows:

- require a pull request before merging;
- require one approval and approval from Code Owners;
- dismiss stale approvals when new commits are pushed;
- require all review conversations to be resolved;
- require the single stable status check below;
- block force pushes and branch deletion;
- do not grant write access to contributors who should not be able to merge.

```text
Required CI
```

Keep PR Governance advisory. Security and compatibility checks run outside the
pull-request path, so they cannot leave contributor PRs waiting on macOS,
Windows, CodeQL, or gitleaks downloads.

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
