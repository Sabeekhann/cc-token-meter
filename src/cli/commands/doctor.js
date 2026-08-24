import fs from 'node:fs';
import path from 'node:path';
import { discoverSessionFiles } from '../../ingest/discover.js';
import {
  LOCAL_INDEX_VERSION,
  readLocalIndex,
} from '../../ingest/localIndex.js';
import { PRICING_VERIFIED_ON } from '../../pricing/models.js';
import { resolveHomeDirectory } from '../../paths.js';

const PRICING_STALE_AFTER_DAYS = 90;

export async function doctorCommand({ json = false } = {}) {
  const report = await runDiagnostics();
  if (json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    printDiagnostics(report);
  }
  if (report.overall === 'fail') process.exitCode = 1;
}

export async function runDiagnostics(options = {}) {
  const home = options.homedir || resolveHomeDirectory();
  const platform = options.platform || process.platform;
  const nodeVersion = options.nodeVersion || process.versions.node;
  const discoverFiles = options.discoverFiles || discoverSessionFiles;
  const requestedNow = options.now == null ? Date.now() : new Date(options.now).getTime();
  const now = Number.isFinite(requestedNow) ? requestedNow : Date.now();
  const projectsDir = options.projectsDir || path.join(home, '.claude', 'projects');
  const stateDir = options.stateDir || path.join(home, '.claude-token-meter');
  const configFile = options.configFile || path.join(stateDir, 'config.json');
  const indexFile = options.indexFile || path.join(stateDir, `usage-index-v${LOCAL_INDEX_VERSION}.json`);
  const checks = [];

  const nodeMajor = Number.parseInt(String(nodeVersion).split('.')[0], 10);
  checks.push({
    id: 'node',
    level: Number.isFinite(nodeMajor) && nodeMajor >= 20 ? 'pass' : 'fail',
    title: 'Node.js runtime',
    detail: Number.isFinite(nodeMajor) && nodeMajor >= 20
      ? `Node ${nodeVersion} is supported.`
      : `Node ${nodeVersion} is unsupported; install Node 20 or newer.`,
  });

  const pricingAgeDays = Math.max(
    0,
    Math.floor((now - Date.parse(`${PRICING_VERIFIED_ON}T00:00:00.000Z`)) / 86_400_000),
  );
  checks.push({
    id: 'pricing',
    level: pricingAgeDays <= PRICING_STALE_AFTER_DAYS ? 'pass' : 'warn',
    title: 'Pricing table freshness',
    detail: pricingAgeDays <= PRICING_STALE_AFTER_DAYS
      ? `Pricing was verified ${PRICING_VERIFIED_ON} (${pricingAgeDays} day${pricingAgeDays === 1 ? '' : 's'} ago).`
      : `Pricing was last verified ${PRICING_VERIFIED_ON} (${pricingAgeDays} days ago); compare the official Anthropic pricing page before relying on estimates.`,
  });

  if (!fs.existsSync(projectsDir)) {
    checks.push({
      id: 'transcripts',
      level: 'warn',
      title: 'Claude Code transcripts',
      detail: `No transcript directory exists yet at ${projectsDir}. Run Claude Code once, then retry.`,
    });
  } else {
    try {
      fs.accessSync(projectsDir, fs.constants.R_OK);
      const files = await discoverFiles();
      checks.push({
        id: 'transcripts',
        level: files.length > 0 ? 'pass' : 'warn',
        title: 'Claude Code transcripts',
        detail: files.length > 0
          ? `Found ${files.length} readable session file${files.length === 1 ? '' : 's'}.`
          : 'The transcript directory is readable, but no session JSONL files were found.',
      });
    } catch (error) {
      checks.push({
        id: 'transcripts',
        level: 'fail',
        title: 'Claude Code transcripts',
        detail: `Cannot read ${projectsDir}: ${error.message}`,
      });
    }
  }

  checkStateFile(checks, {
    id: 'index',
    title: 'Private usage index',
    filePath: indexFile,
    platform,
    parse: () => readLocalIndex(indexFile),
    describe: (index) => `Healthy index with ${index.sessions.length} session${index.sessions.length === 1 ? '' : 's'}.`,
    missing: 'No usage index yet; the first scan will create it.',
    invalid: 'The index is corrupt or from an unsupported version; it will be rebuilt safely.',
  });

  checkStateFile(checks, {
    id: 'config',
    title: 'Budget configuration',
    filePath: configFile,
    platform,
    parse: () => JSON.parse(fs.readFileSync(configFile, 'utf8')),
    describe: () => 'Budget configuration is valid JSON.',
    missing: 'No budget config yet; built-in defaults are active.',
    invalid: 'Budget configuration is malformed; defaults will be used until it is replaced.',
  });

  if (fs.existsSync(stateDir) && platform !== 'win32') {
    const mode = fs.statSync(stateDir).mode & 0o777;
    checks.push({
      id: 'state-permissions',
      level: (mode & 0o077) === 0 ? 'pass' : 'warn',
      title: 'Local state permissions',
      detail: (mode & 0o077) === 0
        ? `State directory permissions are private (${octal(mode)}).`
        : `State directory permissions are ${octal(mode)}; run chmod 700 "${stateDir}".`,
    });
  }

  const overall = checks.some((check) => check.level === 'fail')
    ? 'fail'
    : checks.some((check) => check.level === 'warn')
      ? 'warn'
      : 'pass';

  return {
    generatedAt: new Date().toISOString(),
    overall,
    checks,
  };
}

function checkStateFile(checks, options) {
  if (!fs.existsSync(options.filePath)) {
    checks.push({ id: options.id, level: 'warn', title: options.title, detail: options.missing });
    return;
  }

  let parsed;
  try {
    parsed = options.parse();
  } catch {
    parsed = null;
  }

  if (!parsed) {
    checks.push({ id: options.id, level: 'warn', title: options.title, detail: options.invalid });
    return;
  }

  let detail = options.describe(parsed);
  let level = 'pass';
  if (options.platform !== 'win32') {
    const mode = fs.statSync(options.filePath).mode & 0o777;
    if ((mode & 0o077) !== 0) {
      level = 'warn';
      detail += ` Permissions are ${octal(mode)}; expected 600.`;
    }
  }
  checks.push({ id: options.id, level, title: options.title, detail });
}

function printDiagnostics(report) {
  const icon = { pass: 'PASS', warn: 'WARN', fail: 'FAIL' };
  console.log('cc-token-meter doctor');
  console.log('');
  for (const check of report.checks) {
    console.log(`[${icon[check.level]}] ${check.title}: ${check.detail}`);
  }
  console.log('');
  console.log(`Overall: ${report.overall.toUpperCase()}`);
}

function octal(mode) {
  return mode.toString(8).padStart(3, '0');
}
