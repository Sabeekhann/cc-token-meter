import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const aiWorkflow = fs.readFileSync('.github/workflows/sabees-bot-review.yml', 'utf8');
const governanceWorkflow = fs.readFileSync('.github/workflows/pr-governance.yml', 'utf8');

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
