export const USAGE = `cc-token-meter — local Claude Code token usage & cost dashboard

100% local. No data ever leaves your machine. No telemetry, no analytics,
no network calls except reading files already on your disk.

Usage:
  cc-token-meter                          Start the dashboard server (default)
  cc-token-meter --summary                Print a compact local usage summary, exit
  cc-token-meter --json                   Load/index history, print JSON summary, exit
  cc-token-meter --csv <path|->           Export filtered usage as CSV, exit
  cc-token-meter --doctor                 Diagnose local setup and private state, exit
  cc-token-meter --set-budget-usd <n>          Set daily cost cap (USD) and exit
  cc-token-meter --set-budget-tokens <n>       Set daily token cap and exit
  cc-token-meter --set-session-budget-usd <n>  Set per-session cost cap (USD) and exit
  cc-token-meter --help                   Show this help
  cc-token-meter --version                Show version

Options:
  --port <n>       Port to listen on (default: 4317, or next free port)
  --no-open        Don't automatically open a browser window
  --no-cache       Don't read or write the private local usage index
  --from <date>    Include usage on/after local date YYYY-MM-DD (summary/JSON/CSV)
  --to <date>      Include usage on/before local date YYYY-MM-DD (summary/JSON/CSV)
  --project <text> Filter project paths by case-insensitive substring (summary/JSON/CSV)
  --group-by <n>   CSV rows: day, project, branch, or session (default: day)

Examples:
  npx cc-token-meter
  npx cc-token-meter --port 5000 --no-open
  npx cc-token-meter --no-cache
  npx cc-token-meter --summary
  npx cc-token-meter --summary --from 2026-08-01 --project my-app
  npx cc-token-meter --json
  npx cc-token-meter --doctor
  npx cc-token-meter --doctor --json
  npx cc-token-meter --csv usage.csv --from 2026-08-01 --group-by project
  npx cc-token-meter --csv - --project my-app --group-by session
  npx cc-token-meter --set-budget-usd 20
`;

export async function helpCommand() {
  console.log(USAGE);
}
