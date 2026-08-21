import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const aiWorkflow = fs.readFileSync('.github/workflows/sabees-bot-review.yml', 'utf8');
const governanceWorkflow = fs.readFileSync('.github/workflows/pr-governance.yml', 'utf8');
const ciWorkflow = fs.readFileSync('.github/workflows/tests.yml', 'utf8');
const compatibilityWorkflow = fs.readFileSync('.github/workflows/compatibility.yml', 'utf8');
const securityWorkflow = fs.readFileSync('.github/workflows/security.yml', 'utf8');

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
});

test('heavy security scans stay off the pull-request path', () => {
  assert.doesNotMatch(securityWorkflow, /\n  pull_request:/);
  assert.match(securityWorkflow, /schedule:/);
  assert.match(securityWorkflow, /workflow_dispatch:/);
});

test('AI review runs only when a maintainer applies the opt-in label', () => {
  assert.match(aiWorkflow, /types: \[labeled\]/);
  assert.equal((aiWorkflow.match(/github\.event\.label\.name == 'ai-review'/g) || []).length, 2);
  assert.match(governanceWorkflow, /'ai-review'/);
});

test('AI review keeps fork code behind a manual gate and fixed-repository checkout', () => {
  assert.match(aiWorkflow, /environment: external-pr-review/);
  assert.match(aiWorkflow, /repository: \$\{\{ github\.event\.pull_request\.head\.repo\.full_name \}\}/);
  assert.match(aiWorkflow, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(aiWorkflow, /allow-unsafe-pr-checkout: true/);
});

test('AI review disables project execution surfaces and rejects a head-provided verdict', () => {
  assert.equal((aiWorkflow.match(/--bare/g) || []).length, 2);
  assert.equal((aiWorkflow.match(/--disallowedTools "Bash,Edit,NotebookEdit,mcp__\*"/g) || []).length, 2);
  assert.equal((aiWorkflow.match(/rm -f -- \.claude-review-verdict/g) || []).length, 2);
  assert.doesNotMatch(aiWorkflow, /id-token: write/);
});

test('PR governance checks out trusted base code instead of PR head code', () => {
  assert.match(governanceWorkflow, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  assert.doesNotMatch(governanceWorkflow, /pull_request\.head\.sha/);
});
