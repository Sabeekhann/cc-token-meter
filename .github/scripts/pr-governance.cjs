'use strict';

const CONVENTIONAL_TITLE = /^(?:feat|fix|perf|refactor|docs|test|build|ci|chore|revert)(?:\([a-z0-9][a-z0-9._/-]*\))?!?:\s+\S.{2,}$/i;
const REQUIRED_HEADINGS = [
  'Description',
  'Type of Change',
  'Changes Made',
  'Testing',
  'Review Readiness',
];
const MANAGED_PREFIXES = ['area:', 'size:', 'status:'];
const MANAGED_EXACT = new Set(['dependencies', 'documentation', 'tests']);

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripComments(value) {
  return String(value || '').replace(/<!--[\s\S]*?-->/g, '').trim();
}

function section(body, heading) {
  const escaped = escapeRegex(heading);
  const match = String(body || '').match(new RegExp(`^##\\s+${escaped}\\s*$([\\s\\S]*?)(?=^##\\s+|(?![\\s\\S]))`, 'im'));
  return stripComments(match ? match[1] : '');
}

function isPlaceholder(value) {
  const normalized = stripComments(value)
    .replace(/^[-*]\s*$/gm, '')
    .replace(/```(?:text)?\s*(?:#\s*)?(?:paste|add)[\s\S]*?```/gi, '')
    .trim();
  return normalized === '' || /^(?:tbd|todo|n\/a|none)$/i.test(normalized);
}

function validatePullRequest({ title, body, draft = false, automation = false }) {
  if (automation) {
    return { valid: true, errors: [], warnings: [] };
  }

  const errors = [];
  const warnings = [];
  const source = String(body || '');

  if (!CONVENTIONAL_TITLE.test(String(title || ''))) {
    errors.push('Use a Conventional Commit title, for example `feat(dashboard): add live cache health`.');
  }

  for (const heading of REQUIRED_HEADINGS) {
    if (!new RegExp(`^##\\s+${escapeRegex(heading)}\\s*$`, 'im').test(source)) {
      errors.push(`Add the \`## ${heading}\` section from the pull request template.`);
    }
  }

  if (isPlaceholder(section(source, 'Description'))) {
    errors.push('Replace the Description placeholder with the problem and why the change is needed.');
  }
  if (!/-\s*\[[xX]\]\s+.+/m.test(section(source, 'Type of Change'))) {
    errors.push('Check at least one item under Type of Change.');
  }
  if (isPlaceholder(section(source, 'Changes Made'))) {
    errors.push('List the concrete implementation changes under Changes Made.');
  }
  const testing = section(source, 'Testing');
  const hasCheckedTest = /-\s*\[[xX]\]\s+.+/m.test(testing);
  const testingNarrative = testing.replace(/^-\s*\[[ xX]\].*$/gm, '');
  const explainsMissingTest = /\b(?:not run|not tested|not applicable|n\/a)\b/i.test(testingNarrative);
  if (isPlaceholder(testing) || (!hasCheckedTest && !explainsMissingTest)) {
    errors.push('Document tests that ran, or state exactly what was not run and why.');
  }

  if (!draft) {
    const readiness = section(source, 'Review Readiness');
    if (!/-\s*\[[xX]\]\s+I have performed a self-review/i.test(readiness)) {
      errors.push('Check “I have performed a self-review” before requesting review.');
    }
    if (!/-\s*\[[xX]\]\s+This PR is ready for human review/i.test(readiness)) {
      errors.push('Check “This PR is ready for human review” before requesting review.');
    }
  } else {
    warnings.push('Draft PRs may leave Review Readiness unchecked until the implementation is complete.');
  }

  return { valid: errors.length === 0, errors, warnings };
}

function labelsForFiles(files) {
  const labels = new Set();
  for (const file of files) {
    const filename = typeof file === 'string' ? file : file.filename;
    if (!filename) continue;

    if (filename.startsWith('public/')) labels.add('area: dashboard');
    if (filename.startsWith('src/cli/') || filename.startsWith('bin/')) labels.add('area: cli');
    if (/^src\/(?:analytics|budget|heuristics|ingest|pricing)\//.test(filename)) labels.add('area: intelligence');
    if (filename.startsWith('src/server/')) labels.add('area: server');
    if (filename.startsWith('.github/')) labels.add('area: ci');
    if (filename.startsWith('test/')) labels.add('tests');
    if (filename === 'README.md' || filename === 'CONTRIBUTING.md' || filename.startsWith('docs/')) labels.add('documentation');
    if (filename === 'package.json' || filename === 'package-lock.json') labels.add('dependencies');
  }
  return [...labels].sort();
}

function sizeLabel(changes) {
  if (changes <= 10) return 'size: XS';
  if (changes <= 100) return 'size: S';
  if (changes <= 500) return 'size: M';
  if (changes <= 1000) return 'size: L';
  return 'size: XL';
}

function desiredLabels({ files, changes, draft, valid, automation = false }) {
  const labels = new Set(labelsForFiles(files));
  labels.add(sizeLabel(changes));

  if (automation) {
    labels.add('status: automation');
  } else if (draft) {
    labels.add('status: draft');
    if (!valid) labels.add('status: needs author action');
  } else if (valid) {
    labels.add('status: ready for review');
  } else {
    labels.add('status: needs author action');
  }

  return [...labels].sort();
}

function isManagedLabel(label) {
  return MANAGED_EXACT.has(label) || MANAGED_PREFIXES.some((prefix) => label.startsWith(prefix));
}

function buildComment({ validation, labels, draft, automation }) {
  const marker = '<!-- cc-token-meter-pr-governance -->';
  const status = automation
    ? 'Automation PR detected; template enforcement is skipped.'
    : validation.valid
      ? draft
        ? 'Draft metadata looks complete. Mark it ready when testing is finished.'
        : 'PR metadata is complete and ready for human review.'
      : 'Author action is needed before human review.';

  const lines = [marker, '## CC Token Meter PR bot', '', status];
  if (validation.errors.length > 0) {
    lines.push('', '### Required updates', '', ...validation.errors.map((error) => `- [ ] ${error}`));
  }
  if (validation.warnings.length > 0) {
    lines.push('', '### Notes', '', ...validation.warnings.map((warning) => `- ${warning}`));
  }
  lines.push('', `Managed labels: ${labels.map((label) => `\`${label}\``).join(', ') || 'none'}`);
  lines.push('', '_This comment is updated automatically when the PR changes._');
  return { marker, body: lines.join('\n') };
}

module.exports = {
  CONVENTIONAL_TITLE,
  REQUIRED_HEADINGS,
  buildComment,
  desiredLabels,
  isManagedLabel,
  labelsForFiles,
  section,
  sizeLabel,
  validatePullRequest,
};
