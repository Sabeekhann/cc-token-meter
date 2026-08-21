import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startCommand } from './commands/start.js';
import { jsonCommand } from './commands/json.js';
import { csvCommand } from './commands/csv.js';
import { doctorCommand } from './commands/doctor.js';
import { summaryCommand } from './commands/summary.js';
import { setBudgetCommand } from './commands/setBudget.js';
import { helpCommand, USAGE } from './commands/help.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readPackageVersion() {
  try {
    const pkgPath = path.join(__dirname, '..', '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return pkg.version;
  } catch {
    return 'unknown';
  }
}

/**
 * Parse a small fixed set of CLI flags out of argv. No dependency needed —
 * the flag surface is intentionally small.
 *
 * @param {string[]} argv
 */
function parseArgs(argv) {
  const opts = {
    port: 4317,
    open: true,
    cache: true,
    json: false,
    summary: false,
    doctor: false,
    csvPath: null,
    groupBy: 'day',
    from: null,
    to: null,
    project: null,
    help: false,
    version: false,
    setBudgetUsd: null,
    setBudgetTokens: null,
    setSessionBudgetUsd: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--port': {
        const value = argv[++i];
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
          throw new Error(`--port requires an integer from 1 to 65535, got: ${value}`);
        }
        opts.port = parsed;
        break;
      }
      case '--no-open':
        opts.open = false;
        break;
      case '--no-cache':
        opts.cache = false;
        break;
      case '--set-budget-usd': {
        const value = argv[++i];
        opts.setBudgetUsd = parseRequiredNumber('--set-budget-usd', value);
        break;
      }
      case '--set-budget-tokens': {
        const value = argv[++i];
        opts.setBudgetTokens = parseRequiredNumber('--set-budget-tokens', value);
        break;
      }
      case '--set-session-budget-usd': {
        const value = argv[++i];
        opts.setSessionBudgetUsd = parseRequiredNumber('--set-session-budget-usd', value);
        break;
      }
      case '--json':
        opts.json = true;
        break;
      case '--summary':
        opts.summary = true;
        break;
      case '--doctor':
        opts.doctor = true;
        break;
      case '--csv':
        opts.csvPath = parseRequiredString('--csv', argv[++i]);
        break;
      case '--group-by': {
        const value = parseRequiredString('--group-by', argv[++i]);
        if (!['day', 'project', 'branch', 'session'].includes(value)) {
          throw new Error(`--group-by must be one of: day, project, branch, session; got: ${value}`);
        }
        opts.groupBy = value;
        break;
      }
      case '--from':
        opts.from = parseDate('--from', argv[++i]);
        break;
      case '--to':
        opts.to = parseDate('--to', argv[++i]);
        break;
      case '--project':
        opts.project = parseRequiredString('--project', argv[++i]);
        break;
      case '--help':
      case '-h':
        opts.help = true;
        break;
      case '--version':
      case '-v':
        opts.version = true;
        break;
      default:
        // Unknown flag — ignore rather than hard-fail, to stay forgiving
        // for forward-compat / accidental extra args.
        break;
    }
  }

  if (opts.from && opts.to && opts.from > opts.to) {
    throw new Error(`--from (${opts.from}) must not be after --to (${opts.to})`);
  }

  const outputModeCount = [
    opts.doctor,
    opts.summary,
    opts.csvPath !== null,
    opts.json && !opts.doctor,
  ].filter(Boolean).length;
  if (outputModeCount > 1) {
    throw new Error('choose only one output mode: --summary, --json, --csv, or --doctor');
  }

  return opts;
}

function parseRequiredNumber(flagName, value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${flagName} requires a numeric value, got: ${value}`);
  }
  return parsed;
}

function parseRequiredString(flagName, value) {
  if (typeof value !== 'string' || value.length === 0 || value.startsWith('--')) {
    throw new Error(`${flagName} requires a value`);
  }
  return value;
}

function parseDate(flagName, value) {
  const date = parseRequiredString(flagName, value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`${flagName} requires YYYY-MM-DD, got: ${date}`);
  }
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error(`${flagName} requires a real calendar date, got: ${date}`);
  }
  return date;
}

export async function main(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    console.error(`cc-token-meter: ${err.message}`);
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  if (opts.help) {
    await helpCommand();
    return;
  }

  if (opts.version) {
    console.log(readPackageVersion());
    return;
  }

  if (opts.setBudgetUsd !== null) {
    await setBudgetCommand({ dailyCostCapUsd: opts.setBudgetUsd });
    return;
  }

  if (opts.setBudgetTokens !== null) {
    await setBudgetCommand({ dailyTokenCap: opts.setBudgetTokens });
    return;
  }

  if (opts.setSessionBudgetUsd !== null) {
    await setBudgetCommand({ sessionCostCapUsd: opts.setSessionBudgetUsd });
    return;
  }

  if (opts.doctor) {
    await doctorCommand({ json: opts.json });
    return;
  }

  const filters = { from: opts.from, to: opts.to, project: opts.project };

  if (opts.csvPath !== null) {
    try {
      await csvCommand({
        cache: opts.cache,
        outputPath: opts.csvPath,
        groupBy: opts.groupBy,
        filters,
      });
    } catch (err) {
      console.error(`cc-token-meter: ${err.message}`);
      process.exitCode = 1;
    }
    return;
  }

  if (opts.json) {
    await jsonCommand({ cache: opts.cache, filters });
    return;
  }

  if (opts.summary) {
    await summaryCommand({ cache: opts.cache, filters });
    return;
  }

  await startCommand({ port: opts.port, open: opts.open, cache: opts.cache });
}

export { parseArgs, parseDate };
