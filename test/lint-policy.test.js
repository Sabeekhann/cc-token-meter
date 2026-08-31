import assert from 'node:assert/strict';
import test from 'node:test';

import { findLintIssues } from '../.github/scripts/project-policy.mjs';

test('flags a var declaration by default with its line number', () => {
  const issues = findLintIssues('const a = 1;\nvar b = 2;\n');
  assert.deepEqual(issues, [{ rule: 'no-var', line: 2 }]);
});

test('allows var when allowVar is set (browser sources)', () => {
  assert.deepEqual(findLintIssues('var b = 2;\n', { allowVar: true }), []);
});

test('does not treat member access like .variable as a var declaration', () => {
  assert.deepEqual(findLintIssues('foo.variable = 1;\nconst variable = 2;\n'), []);
});

test('flags a lone debugger statement but not the word in identifiers or strings', () => {
  assert.deepEqual(findLintIssues('  debugger;\n'), [{ rule: 'no-debugger', line: 1 }]);
  assert.deepEqual(findLintIssues('const debuggerEnabled = true;\n'), []);
  assert.deepEqual(findLintIssues("log('start debugger now');\n"), []);
});

test('flags irregular whitespace such as a non-breaking space', () => {
  const nbsp = String.fromCharCode(0x00a0);
  const issues = findLintIssues(`const a =${nbsp}1;\n`);
  assert.deepEqual(issues, [{ rule: 'no-irregular-whitespace', line: 1 }]);
});

test('ordinary spaces, tabs, and newlines are not irregular', () => {
  assert.deepEqual(findLintIssues('const a =\t1;\n  const b = 2;\n'), []);
});
