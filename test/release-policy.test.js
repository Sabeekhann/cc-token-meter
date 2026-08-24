import assert from 'node:assert/strict';
import test from 'node:test';
import { validateRelease } from '../.github/scripts/verify-release.mjs';

function validPackage(overrides = {}) {
  return {
    version: '1.2.3',
    private: false,
    license: 'Apache-2.0',
    repository: {
      url: 'https://github.com/Sabeekhann/cc-token-meter.git',
    },
    publishConfig: {
      access: 'public',
      registry: 'https://registry.npmjs.org',
    },
    files: ['bin', 'src', 'public', 'README.md', 'LICENSE', 'NOTICE'],
    ...overrides,
  };
}

test('release policy accepts an exact tag, public metadata, Apache licensing, and changelog entry', () => {
  const failures = validateRelease({
    tag: 'v1.2.3',
    packageJson: validPackage(),
    changelog: '# Changelog\n\n## [1.2.3] — 2026-08-24\n',
  });

  assert.deepEqual(failures, []);
});

test('release policy rejects mismatched tags and unsafe package metadata', () => {
  const failures = validateRelease({
    tag: 'v1.2.4',
    packageJson: validPackage({
      private: true,
      license: 'MIT',
      repository: { url: 'https://github.com/example/fork.git' },
      publishConfig: { access: 'restricted', registry: 'https://example.invalid' },
      files: ['bin'],
    }),
    changelog: '# Changelog\n',
  });

  assert.equal(failures.length, 12);
  assert.ok(failures.some((failure) => failure.includes('must exactly match v1.2.3')));
  assert.ok(failures.some((failure) => failure.includes('must not mark')));
  assert.ok(failures.some((failure) => failure.includes('license must equal Apache-2.0')));
  assert.ok(failures.some((failure) => failure.includes('repository.url')));
  assert.ok(failures.some((failure) => failure.includes('must include NOTICE')));
  assert.ok(failures.some((failure) => failure.includes('CHANGELOG.md')));
});
