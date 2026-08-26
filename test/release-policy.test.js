import assert from 'node:assert/strict';
import test from 'node:test';
import { validateRelease } from '../.github/scripts/verify-release.mjs';

function validPackage(overrides = {}) {
  return {
    version: '1.2.3',
    private: false,
    license: 'Apache-2.0',
    repository: {
      url: 'git+https://github.com/Sabeekhann/cc-token-meter.git',
    },
    publishConfig: {
      access: 'public',
      registry: 'https://registry.npmjs.org',
    },
    bin: {
      'cc-token-meter': 'bin/cc-token-meter.js',
    },
    engines: {
      node: '>=20',
    },
    files: ['bin', 'src', 'public', 'README.md', 'LICENSE', 'NOTICE', 'REUSE.toml'],
    ...overrides,
  };
}

test('release policy accepts exact tags and normalized publish metadata', () => {
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
      bin: { 'cc-token-meter': './wrong-entry.js' },
      engines: { node: '>=18' },
      files: ['bin'],
    }),
    changelog: '# Changelog\n',
  });

  assert.ok(failures.some((failure) => failure.includes('must exactly match v1.2.3')));
  assert.ok(failures.some((failure) => failure.includes('must not mark')));
  assert.ok(failures.some((failure) => failure.includes('license must equal Apache-2.0')));
  assert.ok(failures.some((failure) => failure.includes('repository.url')));
  assert.ok(failures.some((failure) => failure.includes('bin.cc-token-meter')));
  assert.ok(failures.some((failure) => failure.includes('engines.node')));
  assert.ok(failures.some((failure) => failure.includes('must include NOTICE')));
  assert.ok(failures.some((failure) => failure.includes('must include REUSE.toml')));
  assert.ok(failures.some((failure) => failure.includes('CHANGELOG.md')));
});
