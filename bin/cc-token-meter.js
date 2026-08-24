#!/usr/bin/env node
// Copyright 2026 FiveNodes
// SPDX-License-Identifier: Apache-2.0

import { main } from '../src/cli/index.js';

main(process.argv.slice(2)).catch((err) => {
  console.error('cc-token-meter: fatal error:', err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
