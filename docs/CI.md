# GitHub automation and repository setup

cc-token-meter's automation protects the product's defining constraints: it
must stay local-only, read-only toward Claude Code transcripts, dependency
light, cross-platform, and straightforward to review. The workflows borrow
useful governance patterns from larger repositories without copying checks
that do not fit this small Node.js CLI.

## What runs

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| CI | PRs, pushes to `main`, manual | Project policy, package dry-run, Node 20/22/24 tests on Linux, plus Node 24 tests on macOS and Windows |
| PR Governance | PR metadata/activity | Conventional title and template validation, area/size/status labels, one updated bot comment |
| Security | PRs, pushes to `main`, Mondays, manual | Production `npm audit`, CodeQL, and gitleaks |
| Merge Conflicts | PRs and pushes to `main` | Reject committed conflict markers even in docs-only changes |
| Sabee's Bot | Non-draft PRs | Narrow AI review for architecture and repository-boundary violations |
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
and security checks work without it. The AI workflow starts only after a PR is
not a draft, which avoids spending review tokens on incomplete pushes.
Each review is capped at eight turns and an estimated USD 2 client-side budget.

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

Protect `main`, require a pull request, and require these stable checks:

```text
CI / Required CI
Merge Conflicts / Merge conflict markers
PR Governance / Template and labels
Security / Dependency audit
Security / Secret scan (gitleaks)
```

Also require CodeQL if code scanning is enabled for the repository. Keep
Sabee's Bot advisory: fork reviews intentionally wait for environment approval,
and an unavailable Anthropic API should not block a safe human-reviewed fix.

### 5. Recommended GitHub settings

- Enable private vulnerability reporting and Dependabot alerts.
- Enable secret scanning and push protection when available.
- Require conversations to be resolved before merge.
- Prefer squash merge so the Conventional Commit PR title becomes the clean
  commit/release-history entry.
- Do not enable automatic Dependabot merging until branch protection and the
  security checks have demonstrated stable behavior.

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
