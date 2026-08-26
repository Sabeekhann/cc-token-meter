import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCsv } from '../src/cli/commands/csv.js';

function projectSummary(project) {
  return {
    byProject: [{
      project,
      sessions: [{}],
      inputTokens: 1,
      outputTokens: 2,
      cacheCreationInputTokens: 3,
      cacheReadInputTokens: 4,
      tokenTotal: 10,
      costUsd: 0.01,
    }],
  };
}

test('CSV export neutralizes spreadsheet formula prefixes in text labels', () => {
  for (const prefix of ['=', '+', '-', '@', '\t', '\r']) {
    const csv = buildCsv(projectSummary(`${prefix}payload`), 'project');
    const dataRow = csv.split('\n')[1];
    assert.ok(
      dataRow.startsWith(`'${prefix}payload,`) || dataRow.startsWith(`"'${prefix}payload`),
      `expected ${JSON.stringify(prefix)} label to be neutralized: ${JSON.stringify(dataRow)}`,
    );
  }
});

test('CSV export still applies RFC-style quoting after formula neutralization', () => {
  const csv = buildCsv(projectSummary('=SUM(A1,A2)'), 'project');
  const dataRow = csv.split('\n')[1];
  assert.ok(dataRow.startsWith('"\'=SUM(A1,A2)"'));
});

test('ordinary labels remain unchanged', () => {
  const csv = buildCsv(projectSummary('my-project'), 'project');
  const dataRow = csv.split('\n')[1];
  assert.ok(dataRow.startsWith('my-project,'));
});
