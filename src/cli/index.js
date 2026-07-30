import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startCommand } from './commands/start.js';
import { jsonCommand } from './commands/json.js';
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
    json: false,
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
        if (!Number.isFinite(parsed) || parsed <= 0) {
          throw new Error(`--port requires a positive number, got: ${value}`);
        }
        opts.port = parsed;
        break;
      }
      case '--no-open':
        opts.open = false;
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

  return opts;
}

function parseRequiredNumber(flagName, value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${flagName} requires a numeric value, got: ${value}`);
  }
  return parsed;
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

  if (opts.json) {
    await jsonCommand();
    return;
  }

  await startCommand({ port: opts.port, open: opts.open });
}
