import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUsageIntelligence } from '../src/analytics/overview.js';

test('buildUsageIntelligence reports active work, live velocity, cache health, and model mix', () => {
  const now = '2026-08-21T12:00:00.000Z';
  const sessions = [
    {
      sessionId: 'active-session',
      projectCwd: '/work/active',
      gitBranch: 'main',
      lastTimestamp: '2026-08-21T11:59:00.000Z',
      usageRecords: [
        {
          sessionId: 'active-session',
          timestamp: '2026-08-21T11:50:00.000Z',
          model: 'claude-sonnet-5',
          gitBranch: 'main',
          inputTokens: 100,
          outputTokens: 20,
          cacheCreationInputTokens: 50,
          cacheReadInputTokens: 0,
          costUsd: 1,
          estimatedCostUsed: false,
        },
        {
          sessionId: 'active-session',
          timestamp: '2026-08-21T11:59:00.000Z',
          model: 'claude-sonnet-5',
          gitBranch: 'main',
          inputTokens: 50,
          outputTokens: 10,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 200,
          costUsd: 0.5,
          estimatedCostUsed: false,
        },
      ],
    },
    {
      sessionId: 'old-session',
      projectCwd: '/work/old',
      gitBranch: null,
      lastTimestamp: '2026-08-21T10:00:00.000Z',
      usageRecords: [
        {
          sessionId: 'old-session',
          timestamp: '2026-08-21T10:00:00.000Z',
          model: 'custom-unknown-model',
          inputTokens: 10,
          outputTokens: 0,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          costUsd: 0.2,
          estimatedCostUsed: true,
        },
      ],
    },
  ];

  const result = buildUsageIntelligence(sessions, { now });

  assert.equal(result.active.sessionCount, 1);
  assert.equal(result.active.latestSessionId, 'active-session');
  assert.equal(result.active.latestProject, '/work/active');
  assert.equal(result.active.latestBranch, 'main');

  assert.equal(result.velocity.messageCount, 2);
  assert.equal(result.velocity.tokenTotal, 430);
  assert.equal(result.velocity.costUsd, 1.5);
  assert.equal(result.velocity.tokensPerMinute, 430 / 15);
  assert.equal(result.velocity.costPerHour, 6);

  assert.equal(result.cache.freshInputTokens, 160);
  assert.equal(result.cache.cacheCreationTokens, 50);
  assert.equal(result.cache.cacheReadTokens, 200);
  assert.equal(result.cache.reuseRate, 200 / 410);
  assert.ok(result.cache.estimatedSavingsUsd > 0);

  assert.deepEqual(
    result.models.map((model) => model.model),
    ['claude-sonnet-5', 'custom-unknown-model']
  );
  assert.equal(result.models[0].costUsd, 1.5);
  assert.equal(result.dataQuality.messageCount, 3);
  assert.equal(result.dataQuality.estimatedCostMessageCount, 1);
  assert.equal(result.dataQuality.missingBranchCount, 1);
});

test('buildUsageIntelligence is stable for empty input and invalid clock values', () => {
  const result = buildUsageIntelligence([], { now: 'not-a-date' });

  assert.equal(result.active.sessionCount, 0);
  assert.equal(result.velocity.tokenTotal, 0);
  assert.equal(result.velocity.costUsd, 0);
  assert.equal(result.cache.reuseRate, 0);
  assert.deepEqual(result.models, []);
  assert.equal(result.dataQuality.messageCount, 0);
});
