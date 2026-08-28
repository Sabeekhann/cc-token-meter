import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const governanceWorkflow = fs.readFileSync('.github/workflows/pr-governance.yml', 'utf8');
const ciWorkflow = fs.readFileSync('.github/workflows/tests.yml', 'utf8');
const compatibilityWorkflow = fs.readFileSync('.github/workflows/compatibility.yml', 'utf8');
const securityWorkflow = fs.readFileSync('.github/workflows/security.yml', 'utf8');
const publishWorkflow = fs.readFileSync('.github/workflows/publish.yml', 'utf8');
const codecovConfig = fs.readFileSync('codecov.yml', 'utf8');

test('pull requests have one fast required CI job', () => {
  assert.match(ciWorkflow, /required:\n    name: Required/);
  assert.doesNotMatch(ciWorkflow, /matrix:/);
  assert.match(ciWorkflow, /npm run check/);
  assert.match(ciWorkflow, /npm test/);
  assert.match(ciWorkflow, /npm audit --omit=dev --audit-level=high/);
  assert.match(ciWorkflow, /--test-coverage-include='src\/\*\*\/\*\.js'/);
  assert.match(ciWorkflow, /--test-reporter=lcov/);
  assert.match(ciWorkflow, /codecov\/codecov-action@[0-9a-f]{40}/);
  assert.doesNotMatch(ciWorkflow, /codecov\/codecov-action@v\d/);
  assert.match(ciWorkflow, /use_oidc: true/);
  assert.match(ciWorkflow, /fail_ci_if_error: false/);
  assert.match(codecovConfig, /project:[\s\S]*informational: true/);
  assert.match(codecovConfig, /patch:[\s\S]*informational: true/);
  assert.match(ciWorkflow, /Reject unresolved merge-conflict markers/);
  assert.match(ciWorkflow, /version=1\.7\.12/);
  assert.match(ciWorkflow, /actionlint_\$\{version\}_linux_amd64\.tar\.gz/);
  assert.match(ciWorkflow, /8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8/);
  assert.match(ciWorkflow, /sha256sum --check/);
  assert.match(ciWorkflow, /actionlint" -no-color/);
});

test('cross-platform compatibility becomes a stable gate after draft review', () => {
  assert.match(compatibilityWorkflow, /\n  pull_request:/);
  assert.match(compatibilityWorkflow, /types: \[opened, ready_for_review, reopened, synchronize\]/);
  assert.match(compatibilityWorkflow, /github\.event\.pull_request\.draft == false/);
  assert.match(compatibilityWorkflow, /gate:\n    name: Compatibility gate/);
  assert.match(compatibilityWorkflow, /needs: \[test\]/);
  assert.match(compatibilityWorkflow, /MATRIX_RESULT: \$\{\{ needs\.test\.result \}\}/);
  assert.match(compatibilityWorkflow, /ubuntu-latest/);
  assert.match(compatibilityWorkflow, /macos-latest/);
  assert.match(compatibilityWorkflow, /windows-latest/);
  assert.match(compatibilityWorkflow, /node-version: 20\.x/);
  assert.match(compatibilityWorkflow, /node-version: 24\.x/);
  assert.match(compatibilityWorkflow, /npm run benchmark:large/);
  assert.match(compatibilityWorkflow, /matrix\.node-version == '20\.x'/);
  assert.match(compatibilityWorkflow, /matrix\.node-version == '24\.x'/);
});

test('heavy security scans stay off the pull-request path', () => {
  assert.doesNotMatch(securityWorkflow, /\n  pull_request:/);
  assert.match(securityWorkflow, /schedule:/);
  assert.match(securityWorkflow, /workflow_dispatch:/);
  assert.doesNotMatch(securityWorkflow, /github\/codeql-action\/(?:init|analyze)@v\d/);
});

test('PR governance checks out trusted base code instead of PR head code', () => {
  assert.match(governanceWorkflow, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  assert.doesNotMatch(governanceWorkflow, /pull_request\.head\.sha/);
});

test('publishing is isolated to a maintainer-created GitHub release and uses OIDC', () => {
  assert.match(publishWorkflow, /release:\n    types: \[published\]/);
  assert.doesNotMatch(publishWorkflow, /\n  pull_request:/);
  assert.doesNotMatch(publishWorkflow, /workflow_dispatch:/);
  assert.match(publishWorkflow, /id-token: write/);
  assert.match(publishWorkflow, /package-manager-cache: false/);
  assert.match(publishWorkflow, /verify-release\.mjs/);
  assert.match(publishWorkflow, /npm publish --access public/);
  const workflowHeader = publishWorkflow.split('\njobs:')[0];
  const [npmPublishJob, githubPackagesJob = ''] = publishWorkflow.split('\n  github-packages:');

  assert.doesNotMatch(workflowHeader, /id-token: write|packages: write/);
  assert.doesNotMatch(publishWorkflow, /NPM_TOKEN/);
  assert.doesNotMatch(npmPublishJob, /NODE_AUTH_TOKEN/);
  assert.match(githubPackagesJob, /packages: write/);
  assert.match(githubPackagesJob, /registry-url: https:\/\/npm\.pkg\.github\.com/);
  assert.match(githubPackagesJob, /NODE_AUTH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/);
});

test('community health files cover conduct and private security reporting', () => {
  assert.equal(fs.existsSync('CODE_OF_CONDUCT.md'), true);
  assert.equal(fs.existsSync('SECURITY.md'), true);
  assert.match(fs.readFileSync('SECURITY.md', 'utf8'), /security\/advisories\/new/);
});
