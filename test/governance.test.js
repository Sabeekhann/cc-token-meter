import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildComment,
  desiredLabels,
  labelsForFiles,
  section,
  sizeLabel,
  validatePullRequest,
} = require('../.github/scripts/pr-governance.cjs');

const READY_BODY = `
## Description

Make live cache health easier to understand without exposing transcripts.

## Type of Change

- [x] New feature
- [ ] Bug fix

## Changes Made

- Add a local cache-health summary.
- Render it in the Overview.

## Testing

- [x] Unit tests pass (\`npm test\`)

## Review Readiness

- [x] I have performed a self-review
- [x] This PR is ready for human review
`;

test('governance accepts a complete ready-for-review PR', () => {
  const result = validatePullRequest({
    title: 'feat(dashboard): add cache health summary',
    body: READY_BODY,
    draft: false,
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('governance reports template placeholders and an invalid title', () => {
  const result = validatePullRequest({
    title: 'Update dashboard',
    body: `
## Description
<!-- explain -->
## Type of Change
- [ ] Bug fix
## Changes Made
-
## Testing
- [ ] Unit tests pass
## Review Readiness
- [ ] I have performed a self-review
- [ ] This PR is ready for human review
`,
    draft: false,
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('Conventional Commit')));
  assert.ok(result.errors.some((error) => error.includes('Description placeholder')));
  assert.ok(result.errors.some((error) => error.includes('Type of Change')));
  assert.ok(result.errors.some((error) => error.includes('tests that ran')));
  assert.ok(result.errors.some((error) => error.includes('ready for human review')));
});

test('draft PRs can defer readiness checkboxes', () => {
  const draftBody = READY_BODY
    .replace('- [x] I have performed a self-review', '- [ ] I have performed a self-review')
    .replace('- [x] This PR is ready for human review', '- [ ] This PR is ready for human review');
  const result = validatePullRequest({
    title: 'feat(dashboard): add cache health summary',
    body: draftBody,
    draft: true,
  });

  assert.equal(result.valid, true);
  assert.equal(result.warnings.length, 1);
});

test('an unchecked Not tested option is not testing evidence', () => {
  const result = validatePullRequest({
    title: 'fix(server): reject an invalid budget payload',
    body: READY_BODY.replace(
      '- [x] Unit tests pass (`npm test`)',
      '- [ ] Unit tests pass (`npm test`)\n- [ ] Not tested (explain why below)',
    ),
    draft: false,
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('tests that ran')));
});

test('automation PRs bypass human-authored template enforcement', () => {
  const result = validatePullRequest({
    title: 'Bump open from 10.1.0 to 10.2.0',
    body: '',
    automation: true,
  });

  assert.equal(result.valid, true);
});

test('file and size labels are deterministic and project-specific', () => {
  const files = [
    { filename: 'public/dashboard.js' },
    { filename: 'src/analytics/overview.js' },
    { filename: 'test/analytics.test.js' },
    { filename: 'README.md' },
    { filename: 'package.json' },
  ];

  assert.deepEqual(labelsForFiles(files), [
    'area: dashboard',
    'area: intelligence',
    'dependencies',
    'documentation',
    'tests',
  ]);
  assert.equal(sizeLabel(10), 'size: XS');
  assert.equal(sizeLabel(11), 'size: S');
  assert.equal(sizeLabel(501), 'size: L');
  assert.equal(sizeLabel(1001), 'size: XL');

  assert.deepEqual(desiredLabels({ files, changes: 80, draft: false, valid: true }), [
    'area: dashboard',
    'area: intelligence',
    'dependencies',
    'documentation',
    'size: S',
    'status: ready for review',
    'tests',
  ]);
});

test('governance extracts the final section and builds one stable bot comment', () => {
  assert.match(section('## Testing\n\nNot run: docs-only change.', 'Testing'), /docs-only/);

  const validation = { valid: false, errors: ['Add testing evidence.'], warnings: [] };
  const comment = buildComment({ validation, labels: ['status: needs author action'], draft: false, automation: false });
  assert.match(comment.body, /cc-token-meter-pr-governance/);
  assert.match(comment.body, /Add testing evidence/);
  assert.match(comment.body, /updated automatically/);
});
