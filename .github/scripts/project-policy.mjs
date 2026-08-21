import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE_ROOTS = ['bin', 'src', 'public', 'test', '.github/scripts'];
const PURE_PATHS = [
  'src/analytics',
  'src/heuristics',
  'src/pricing',
  'src/budget/alerts.js',
  'src/ingest/aggregate.js',
];
const ALLOWED_RUNTIME_DEPENDENCIES = new Set(['glob', 'open']);
const CODE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);

const failures = [];
let syntaxFileCount = 0;

function relative(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join('/');
}

function walk(targetPath) {
  if (!fs.existsSync(targetPath)) return [];
  const stat = fs.statSync(targetPath);
  if (stat.isFile()) return [targetPath];

  return fs.readdirSync(targetPath, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules') return [];
    return walk(path.join(targetPath, entry.name));
  });
}

function fail(rule, message) {
  failures.push({ rule, message });
}

function checkSyntax() {
  const files = SOURCE_ROOTS.flatMap((root) => walk(path.join(ROOT, root)))
    .filter((file) => CODE_EXTENSIONS.has(path.extname(file)))
    .sort();

  for (const file of files) {
    syntaxFileCount += 1;
    const result = spawnSync(process.execPath, ['--check', file], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      fail('syntax', `${relative(file)}\n${(result.stderr || result.stdout).trim()}`);
    }
  }
}

function checkRuntimeDependencies() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const dependencies = Object.keys(packageJson.dependencies || {});
  const devDependencies = Object.keys(packageJson.devDependencies || {});
  const unexpected = dependencies.filter((name) => !ALLOWED_RUNTIME_DEPENDENCIES.has(name));
  const missing = [...ALLOWED_RUNTIME_DEPENDENCIES].filter((name) => !dependencies.includes(name));

  if (unexpected.length > 0) {
    fail(
      'dependency-footprint',
      `Unexpected runtime dependencies: ${unexpected.join(', ')}. Update the project policy only after documenting why vanilla Node is insufficient.`,
    );
  }
  if (missing.length > 0) {
    fail('dependency-footprint', `Project policy is stale; expected dependencies are missing: ${missing.join(', ')}.`);
  }
  if (devDependencies.length > 0) {
    fail(
      'dependency-footprint',
      `Unexpected development dependencies: ${devDependencies.join(', ')}. This repository intentionally uses Node's built-in test and policy tooling.`,
    );
  }
}

function checkPureModuleBoundaries() {
  const bannedImport = /(?:from\s*|import\s*\(|require\s*\(\s*)['"](?:node:)?(?:fs(?:\/promises)?|http|https|net|tls|dns|dgram|child_process)['"]/;
  const networkCall = /\bfetch\s*\(/;

  for (const target of PURE_PATHS) {
    const files = walk(path.join(ROOT, target)).filter((file) => CODE_EXTENSIONS.has(path.extname(file)));
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      if (bannedImport.test(source)) {
        fail('pure-module-boundary', `${relative(file)} imports an I/O or networking module.`);
      }
      if (networkCall.test(source)) {
        fail('pure-module-boundary', `${relative(file)} calls fetch(); analytics and policy modules must stay local and pure.`);
      }
    }
  }
}

function checkDashboardIsLocalOnly() {
  const files = walk(path.join(ROOT, 'public')).filter((file) => ['.html', '.css', '.js'].includes(path.extname(file)));
  const remoteAsset = /(?:src|href)\s*=\s*['"](?:https?:)?\/\//i;
  const remoteCss = /url\(\s*['"]?(?:https?:)?\/\//i;
  const localRequest = /(?:fetch\s*\(|new\s+EventSource\s*\()\s*['"]([^'"]+)['"]/g;

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    if (remoteAsset.test(source) || remoteCss.test(source)) {
      fail('local-only-dashboard', `${relative(file)} references a remote asset.`);
    }

    const requests = [...source.matchAll(/(?:\bfetch\s*\(|new\s+EventSource\s*\()/g)];
    const literalRequests = [...source.matchAll(localRequest)];
    if (requests.length !== literalRequests.length) {
      fail('local-only-dashboard', `${relative(file)} contains a dynamic browser request target that cannot be verified as local.`);
    }

    for (const match of literalRequests) {
      if (!match[1].startsWith('/')) {
        fail('local-only-dashboard', `${relative(file)} makes a non-local request to ${match[1]}.`);
      }
    }
  }
}

function checkLoopbackAndHeaders() {
  const serverPath = path.join(ROOT, 'src/server/index.js');
  const source = fs.readFileSync(serverPath, 'utf8');

  if (!/server\.listen\(port,\s*['"]127\.0\.0\.1['"]/.test(source)) {
    fail('loopback-only', 'src/server/index.js must bind the dashboard server to 127.0.0.1.');
  }
  if (!source.includes("connect-src 'self'")) {
    fail('browser-security', 'src/server/index.js must keep a restrictive connect-src CSP.');
  }
  if (!source.includes("'X-Content-Type-Options': 'nosniff'")) {
    fail('browser-security', 'src/server/index.js must send X-Content-Type-Options: nosniff.');
  }
}

checkSyntax();
checkRuntimeDependencies();
checkPureModuleBoundaries();
checkDashboardIsLocalOnly();
checkLoopbackAndHeaders();

if (failures.length > 0) {
  console.error(`Project policy failed with ${failures.length} violation(s):`);
  for (const { rule, message } of failures) {
    console.error(`\n[${rule}] ${message}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Project policy passed (${syntaxFileCount} JavaScript files checked).`);
  console.log('Verified: local-only dashboard, loopback server, pure analytics, and dependency footprint.');
}
