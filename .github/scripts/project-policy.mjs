import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE_ROOTS = ['bin', 'src', 'public', 'test', 'benchmark', '.github/scripts'];
const RUNTIME_ROOTS = ['bin', 'src'];
// `public/` is browser code that deliberately uses `var` for broad
// compatibility; `no-var` is enforced only on the Node sources.
const NO_VAR_ROOTS = ['bin', 'src', 'test', 'benchmark', '.github/scripts'];
const PURE_PATHS = [
  'src/analytics',
  'src/heuristics',
  'src/pricing',
  'src/budget/alerts.js',
  'src/ingest/aggregate.js',
  'src/ingest/retention.js',
];
const ALLOWED_RUNTIME_DEPENDENCIES = new Set(['open']);
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

// Code points ESLint's `no-irregular-whitespace` flags: non-breaking and
// exotic Unicode spaces, line/paragraph separators, BOM, vertical tab, and
// form feed. Ordinary spaces, tabs, and newlines are intentionally absent.
const IRREGULAR_WHITESPACE = new Set([
  0x000b, 0x000c, 0x00a0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004,
  0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f,
  0x205f, 0x3000, 0xfeff,
]);

function hasIrregularWhitespace(line) {
  for (const character of line) {
    if (IRREGULAR_WHITESPACE.has(character.codePointAt(0))) return true;
  }
  return false;
}

/**
 * Blank out string literals, template literals, and comments while keeping
 * every newline in place, so line-based rule scans can't be fooled by the
 * word `var`/`debugger` or an irregular space that only appears inside a
 * quote or a comment (matching ESLint's default "skip strings/comments"
 * behaviour for these rules). This is a deliberately small scanner, not a
 * full tokenizer: regex literals are left intact, which is harmless for the
 * three rules below.
 *
 * @param {string} source
 * @returns {string}
 */
function blankLiteralsAndComments(source) {
  let out = '';
  let mode = 'code'; // 'code' | 'line-comment' | 'block-comment' | string quote char
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];

    if (mode === 'code') {
      if (char === '/' && next === '/') {
        mode = 'line-comment';
        out += '  ';
        i += 1;
      } else if (char === '/' && next === '*') {
        mode = 'block-comment';
        out += '  ';
        i += 1;
      } else if (char === '"' || char === "'" || char === '`') {
        mode = char;
        out += char;
      } else {
        out += char;
      }
      continue;
    }

    if (mode === 'line-comment') {
      if (char === '\n') {
        mode = 'code';
        out += '\n';
      } else {
        out += ' ';
      }
      continue;
    }

    if (mode === 'block-comment') {
      if (char === '*' && next === '/') {
        mode = 'code';
        out += '  ';
        i += 1;
      } else {
        out += char === '\n' ? '\n' : ' ';
      }
      continue;
    }

    // Inside a string / template literal (mode holds the quote char).
    if (char === '\\') {
      out += '  ';
      i += 1;
    } else if (char === mode) {
      mode = 'code';
      out += char;
    } else {
      out += char === '\n' ? '\n' : ' ';
    }
  }
  return out;
}

/**
 * Source-scan lint rules ported from the project's former ESLint config.
 * Pure: takes source text, returns violations with 1-based line numbers.
 * Covers only rules that are sound with a light literal/comment strip
 * (`no-var`, `no-debugger`, `no-irregular-whitespace`). AST-dependent rules
 * such as prefer-const or no-unused-vars are deliberately not attempted.
 *
 * @param {string} source
 * @param {{ allowVar?: boolean }} [options]
 * @returns {{ rule: string, line: number }[]}
 */
function findLintIssues(source, { allowVar = false } = {}) {
  const issues = [];
  const scannable = blankLiteralsAndComments(source).split('\n');

  for (let index = 0; index < scannable.length; index += 1) {
    const line = scannable[index];
    const lineNumber = index + 1;

    if (!allowVar && /(?<![.\w$])var\s/.test(line)) {
      issues.push({ rule: 'no-var', line: lineNumber });
    }
    if (/(?<![.\w$])debugger\s*;?\s*$/.test(line)) {
      issues.push({ rule: 'no-debugger', line: lineNumber });
    }
    if (hasIrregularWhitespace(line)) {
      issues.push({ rule: 'no-irregular-whitespace', line: lineNumber });
    }
  }

  return issues;
}

function checkLintRules() {
  const files = SOURCE_ROOTS.flatMap((root) => walk(path.join(ROOT, root)))
    .filter((file) => CODE_EXTENSIONS.has(path.extname(file)))
    .sort();

  for (const file of files) {
    const rel = relative(file);
    const allowVar = !NO_VAR_ROOTS.some((root) => rel === root || rel.startsWith(`${root}/`));
    const issues = findLintIssues(fs.readFileSync(file, 'utf8'), { allowVar });
    for (const { rule, line } of issues) {
      fail(rule, `${rel}:${line}`);
    }
  }
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

function checkRuntimeIsLocalOnly() {
  const files = RUNTIME_ROOTS.flatMap((root) => walk(path.join(ROOT, root)))
    .filter((file) => CODE_EXTENSIONS.has(path.extname(file)));
  const bannedNetworkImport = /(?:from\s*|import\s*\(|require\s*\(\s*)['"](?:node:)?(?:https|net|tls|dns|dgram|child_process)['"]/;
  const directOutboundCall = /\bfetch\s*\(|\b(?:http|https|net|tls)\s*\.\s*(?:request|get|connect|createConnection)\s*\(/;
  const destructuredHttpClient = /import\s*\{[^}]*\b(?:request|get)\b[^}]*\}\s*from\s*['"](?:node:)?http['"]/s;

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    if (bannedNetworkImport.test(source)) {
      fail('local-only-runtime', `${relative(file)} imports an outbound-network or subprocess primitive.`);
    }
    if (directOutboundCall.test(source) || destructuredHttpClient.test(source)) {
      fail('local-only-runtime', `${relative(file)} contains an outbound request primitive.`);
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

function runPolicy() {
  checkSyntax();
  checkLintRules();
  checkRuntimeDependencies();
  checkPureModuleBoundaries();
  checkRuntimeIsLocalOnly();
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
    console.log('Verified: local-only runtime/dashboard, loopback server, pure analytics, lint rules, and dependency footprint.');
  }
}

const invokedDirectly =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  runPolicy();
}

export { findLintIssues };
