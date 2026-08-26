import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REQUIRED_PACKAGE_FILES = ['bin', 'src', 'public', 'README.md', 'LICENSE', 'NOTICE', 'REUSE.toml'];
const EXPECTED_REPOSITORY = 'git+https://github.com/Sabeekhann/cc-token-meter.git';
const EXPECTED_REGISTRY = 'https://registry.npmjs.org';
const EXPECTED_LICENSE = 'Apache-2.0';
const EXPECTED_BIN = 'bin/cc-token-meter.js';

export function validateRelease({ tag, packageJson, changelog }) {
  const failures = [];
  const version = String(packageJson.version || '');
  const expectedTag = `v${version}`;

  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    failures.push(`package.json version is not a supported SemVer release: ${version || '(missing)'}`);
  }
  if (tag !== expectedTag) {
    failures.push(`release tag ${tag || '(missing)'} must exactly match ${expectedTag}`);
  }
  if (packageJson.private === true) {
    failures.push('package.json must not mark the release package as private');
  }
  if (packageJson.license !== EXPECTED_LICENSE) {
    failures.push(`package.json license must equal ${EXPECTED_LICENSE}`);
  }
  if (packageJson.repository?.url !== EXPECTED_REPOSITORY) {
    failures.push(`package.json repository.url must equal ${EXPECTED_REPOSITORY}`);
  }
  if (packageJson.publishConfig?.access !== 'public') {
    failures.push('package.json publishConfig.access must equal public');
  }
  if (packageJson.publishConfig?.registry !== EXPECTED_REGISTRY) {
    failures.push(`package.json publishConfig.registry must equal ${EXPECTED_REGISTRY}`);
  }
  if (packageJson.bin?.['cc-token-meter'] !== EXPECTED_BIN) {
    failures.push(`package.json bin.cc-token-meter must equal ${EXPECTED_BIN}`);
  }
  if (packageJson.engines?.node !== '>=20') {
    failures.push('package.json engines.node must equal >=20 until the documented support floor changes');
  }

  const publishedFiles = new Set(packageJson.files || []);
  for (const requiredFile of REQUIRED_PACKAGE_FILES) {
    if (!publishedFiles.has(requiredFile)) {
      failures.push(`package.json files must include ${requiredFile}`);
    }
  }

  const changelogHeader = `## [${version}]`;
  if (!changelog.includes(changelogHeader)) {
    failures.push(`CHANGELOG.md must contain a ${changelogHeader} release section`);
  }

  return failures;
}

function run() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const changelog = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  const tag = process.argv[2] || process.env.RELEASE_TAG || '';
  const failures = validateRelease({ tag, packageJson, changelog });

  if (failures.length > 0) {
    console.error('Release validation failed:');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Release validation passed for ${tag}.`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) run();
