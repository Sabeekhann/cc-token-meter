# GitHub automation and repository setup

cc-token-meter's automation protects the product's defining constraints: it
must stay local-only, read-only toward Claude Code transcripts, dependency
light, cross-platform, and straightforward to review. The workflows borrow
useful governance patterns from larger repositories without copying checks
that do not fit this small Node.js CLI.

## What runs

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| CI / Required | PRs, pushes to `main`, manual | One Ubuntu/Node 24 gate: project policy, tests, production audit, package dry-run, CLI smoke tests, and conflict-marker detection |
| Compatibility | Pushes to `main`, manual | Node 20/22 on Linux and Node 24 on macOS/Windows; it has no pull-request trigger |
| PR Governance | PR metadata/activity | Conventional title and template validation, area/size/status labels, one updated bot comment |
| Security | Pushes to `main`, Mondays, manual | Production `npm audit`, CodeQL, and full-history gitleaks scan |
| Sabee's Bot | Non-draft PRs labeled `ai-review` | Opt-in AI review for architecture and repository-boundary violations |
| Dependabot | Weekly | npm and GitHub Actions update PRs |

Verified GitHub-maintained actions are pinned to immutable release commit
SHAs. Dependabot proposes updates so reviewers can verify both the release tag
and replacement commit before merging. Third-party actions that are not yet
pinned must stay version-tagged, least-privilege, and isolated from untrusted
code as described below.

Local equivalent:

```bash
npm ci
npm run ci
npm pack --dry-run
```

## One-time repository-owner setup

### 1. Workflow permissions

In **Settings → Actions → General → Workflow permissions**, allow read and
write permissions. The workflow files still declare least-privilege job
permissions; this repository setting only lets PR Governance create labels and
maintain its single comment. Also enable **Allow GitHub Actions to create and
approve pull requests** if Sabee's Bot should submit formal approve/request-
changes verdicts instead of only its inline review comments.

### 2. AI reviewer secret

In **Settings → Secrets and variables → Actions**, add:

```text
ANTHROPIC_API_KEY
```

Only `sabees-bot-review.yml` uses this secret. All CI, governance, dependency,
and security checks work without it. The AI workflow starts only when a
maintainer applies the `ai-review` label to a non-draft PR. Each review is
capped at eight turns and a USD 2 client-side budget.

### 3. Fork-review environment

Create an environment named exactly:

```text
external-pr-review
```

Add the maintainer as a required reviewer. Fork PR code is never executed by
the AI job: after manual approval, checkout reads the fork at a fixed commit,
the Claude action reviews it as text, and the only allowed repository write is
the review verdict file. Claude runs in bare mode with Bash, project hooks,
plugins, MCP servers, skills, and project instructions disabled. No `npm
install`, tests, or repository scripts run in that privileged job.

PR Governance is safer still: it checks out only the trusted base commit and
uses GitHub API metadata for the PR title, body, and changed-file list.

### 4. Branch protection

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
CI / Required
```

Keep PR Governance and Sabee's Bot advisory. Security and compatibility checks
run outside the pull-request path, so they cannot leave contributor PRs waiting
on macOS, Windows, CodeQL, gitleaks downloads, or AI service availability.

For this personal-account repository, collaborators have write access and can
merge pull requests. To make merging maintainer-only, keep the collaborator
list limited to people who are maintainers; outside contributors can submit
fork pull requests without collaborator access. Repository settings—not a
workflow file—are the enforcement boundary for merge permission.

### 5. Recommended GitHub settings

- Enable private vulnerability reporting and Dependabot alerts.
- Enable secret scanning and push protection when available.
- Prefer squash merge so the Conventional Commit PR title becomes the clean
  commit/release-history entry.
- Leave automatic Dependabot merging disabled; the maintainer reviews and
  merges dependency changes.

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
