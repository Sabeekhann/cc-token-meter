import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const governanceWorkflow = fs.readFileSync('.github/workflows/pr-governance.yml', 'utf8');
const ciWorkflow = fs.readFileSync('.github/workflows/tests.yml', 'utf8');
const compatibilityWorkflow = fs.readFileSync('.github/workflows/compatibility.yml', 'utf8');
const securityWorkflow = fs.readFileSync('.github/workflows/security.yml', 'utf8');
const publishWorkflow = fs.readFileSync('.github/workflows/publish.yml', 'utf8');

test('pull requests have one fast required CI job', () => {
  assert.match(ciWorkflow, /required:\n    name: Required/);
  assert.doesNotMatch(ciWorkflow, /matrix:/);
  assert.match(ciWorkflow, /npm run check/);
  assert.match(ciWorkflow, /npm test/);
  assert.match(ciWorkflow, /npm audit --omit=dev --audit-level=high/);
  assert.match(ciWorkflow, /Reject unresolved merge-conflict markers/);
});

test('cross-platform compatibility runs only after merge or manually', () => {
  assert.doesNotMatch(compatibilityWorkflow, /\n  pull_request:/);
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
  assert.doesNotMatch(publishWorkflow, /NPM_TOKEN|NODE_AUTH_TOKEN/);
});

test('community health files cover conduct and private security reporting', () => {
  assert.equal(fs.existsSync('CODE_OF_CONDUCT.md'), true);
  assert.equal(fs.existsSync('SECURITY.md'), true);
  assert.match(fs.readFileSync('SECURITY.md', 'utf8'), /security\/advisories\/new/);
});
