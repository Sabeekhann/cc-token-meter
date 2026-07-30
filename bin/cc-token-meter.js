#!/usr/bin/env node
import { main } from '../src/cli/index.js';

main(process.argv.slice(2)).catch((err) => {
  console.error('cc-token-meter: fatal error:', err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
