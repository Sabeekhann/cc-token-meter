export const USAGE = `cc-token-meter — local Claude Code token usage & cost dashboard

100% local. No data ever leaves your machine. No telemetry, no analytics,
no network calls except reading files already on your disk.

Usage:
  cc-token-meter                          Start the dashboard server (default)
  cc-token-meter --json                   Cold-scan history, print JSON summary, exit
  cc-token-meter --set-budget-usd <n>          Set daily cost cap (USD) and exit
  cc-token-meter --set-budget-tokens <n>       Set daily token cap and exit
  cc-token-meter --set-session-budget-usd <n>  Set per-session cost cap (USD) and exit
  cc-token-meter --help                   Show this help
  cc-token-meter --version                Show version

Options for the default (start) command:
  --port <n>       Port to listen on (default: 4317, or next free port)
  --no-open        Don't automatically open a browser window

Examples:
  npx cc-token-meter
  npx cc-token-meter --port 5000 --no-open
  npx cc-token-meter --json
  npx cc-token-meter --set-budget-usd 20
`;

export async function helpCommand() {
  console.log(USAGE);
}
