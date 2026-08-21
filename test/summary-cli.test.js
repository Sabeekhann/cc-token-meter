import assert from 'node:assert/strict';
import test from 'node:test';
import { formatCompactSummary } from '../src/cli/commands/summary.js';

test('compact summary reports decision-oriented local usage without raw transcript data', () => {
  const output = formatCompactSummary({
    filters: { from: '2026-08-01', to: null, project: 'token-meter' },
    pricing: { verifiedOn: '2026-08-21' },
    today: { tokenTotal: 428_640, costUsd: 6.84 },
    allTime: { tokenTotal: 12_400_000, costUsd: 194.28 },
    byProject: [{ project: '/Users/demo/work/cc-token-meter', tokenTotal: 8_200_000, costUsd: 121.8 }],
    tips: [{ severity: 'warn' }, { severity: 'info' }],
    intelligence: {
      active: { sessionCount: 2 },
      velocity: { tokensPerMinute: 18_400, costPerHour: 12.48 },
      cache: { reuseRate: 0.57, estimatedSavingsUsd: 31.42 },
      dataQuality: { exactCostMessageCount: 143, messageCount: 148 },
    },
  });

  assert.match(output, /Scope: 2026-08-01 to today · project contains "token-meter"/);
  assert.match(output, /Selected: 12,400,000 tokens · \$194\.28/);
  assert.match(output, /Cache: 57% reuse · \$31\.42 estimated input cost avoided/);
  assert.match(output, /Top project: work\/cc-token-meter/);
  assert.match(output, /Pricing quality: 143\/148 messages matched known pricing/);
  assert.doesNotMatch(output, /prompt|tool result/i);
});

test('compact summary is useful for an empty fresh install', () => {
  const output = formatCompactSummary({});
  assert.match(output, /Scope: all local history/);
  assert.match(output, /Top project: no usage/);
  assert.match(output, /Recommendations: 0 active/);
});
