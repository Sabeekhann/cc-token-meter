import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildWeek, scoreEfficiency } from '../src/analytics/efficiency.js';
import { buildWeeklyReport, pseudonym } from '../src/analytics/weeklyReport.js';
import { parseArgs } from '../src/cli/index.js';
import { handleApiRoute } from '../src/server/routes.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const NOW = new Date(2026, 9, 9, 15, 0); // Fri Oct 9, local time
const at = (day, hour = 10) => new Date(2026, 9, day, hour).toISOString();
const record = (timestamp, overrides = {}) => ({
  timestamp,
  model: 'claude-sonnet-5',
  inputTokens: 100,
  outputTokens: 50,
  cacheCreationInputTokens: 100,
  cacheReadInputTokens: 800,
  costUsd: 1,
  ...overrides,
});
const session = (sessionId, overrides = {}) => ({
  sessionId,
  projectCwd: '/Users/dev/secret-client/app',
  messageCount: 3,
  lastTimestamp: at(9),
  usageRecords: [record(at(9)), record(at(5)), record(at(1))],
  dailyRollups: [],
  ...overrides,
});

test('buildWeek splits the last seven local days from the seven before', () => {
  const week = buildWeek([session('s1', { dailyRollups: [{ date: '2026-09-28', inputTokens: 1000, costUsd: 5, messageCount: 2 }] })], NOW);
  assert.equal(week.start, '2026-10-03');
  assert.equal(week.end, '2026-10-09');
  assert.equal(week.byDay.length, 7);
  assert.equal(week.current.messageCount, 2, 'Oct 9 and Oct 5');
  assert.equal(week.current.costUsd, 2);
  assert.equal(week.previous.messageCount, 3, 'Oct 1 record plus a two-message Sep 28 rollup');
  assert.equal(week.previous.costUsd, 6);
  assert.deepEqual(week.models.map((m) => m.model), ['claude-sonnet-5']);
  assert.deepEqual(week.projects.map((p) => [p.project, p.sessionCount]), [['/Users/dev/secret-client/app', 1]]);
});

test('scoreEfficiency scores cache, recommendations, and compaction with weights', () => {
  const sessions = [
    session('long-compacted', { messageCount: 80, compactDetected: true }),
    session('long-not-compacted', { messageCount: 70, compactDetected: false }),
  ];
  const week = buildWeek(sessions, NOW);
  const tips = [
    { sessionId: 'long-not-compacted', severity: 'warn' },
    { sessionId: 'long-not-compacted', severity: 'info' },
    { sessionId: 'outside-week', severity: 'warn' },
  ];
  const result = scoreEfficiency(week, sessions, tips);
  assert.deepEqual(result.components.map((c) => [c.key, c.points, c.max]), [
    ['cache', 45, 45], // 80% reuse earns full points
    ['recommendations', 28, 35], // 1 warn (−15%) + 1 info (−5%)
    ['compaction', 10, 20], // 1 of 2 long sessions compacted
  ]);
  assert.equal(result.score, 83);
  assert.match(result.suggestion, /\/compact/);
});

test('scoreEfficiency re-weights when a component does not apply, and is null without usage', () => {
  const sessions = [session('short', { usageRecords: [record(at(9), { cacheReadInputTokens: 0, cacheCreationInputTokens: 400 })] })];
  const result = scoreEfficiency(buildWeek(sessions, NOW), sessions, []);
  assert.deepEqual(result.components.map((c) => c.key), ['cache', 'recommendations'], 'no long sessions this week');
  assert.equal(result.components[0].points, 0);
  assert.equal(result.score, Math.round((0 + 35) / (45 + 35) * 100));

  const idle = scoreEfficiency(buildWeek([session('old', { usageRecords: [record(at(1))] })], NOW), [], []);
  assert.deepEqual(idle, { score: null, components: [], suggestion: null });
});

function reportSummary() {
  const sessions = [session('s1', { messageCount: 70, compactDetected: false })];
  const week = buildWeek(sessions, NOW);
  return {
    week,
    efficiency: scoreEfficiency(week, sessions, [{ sessionId: 's1', severity: 'warn' }]),
    sessions: [{ sessionId: 's1', lastTimestamp: at(9) }],
    tips: [{ id: 'repeatedReads:s1:/Users/dev/secret-client/app/keys.js', sessionId: 's1', severity: 'warn', message: 'keys.js was read 5 times', estimatedSavingsUsd: 0.25 }],
    hiddenTips: [],
    pricing: { verifiedOn: '2026-08-26' },
    plan: { plan: 'max20x', planLabel: 'Max 20×', apiValue: { monthToDateUsd: 400, planMonthlyUsd: 200, multipleOfPlan: 2 } },
  };
}

test('weekly report is shareable by default: no project paths or insight text', () => {
  const report = buildWeeklyReport(reportSummary());
  assert.match(report, /^# CC Token Meter weekly report/);
  assert.match(report, /\*\*Sat, Oct 3 – Fri, Oct 9\*\*/);
  assert.match(report, /\| Long-session compaction \| 0\/20 \|/);
  assert.match(report, /\| Estimated cost \| \$2\.00 \| \$1\.00 \| \+100% \|/);
  assert.match(report, /\*\*Max 20× plan:\*\* \$400\.00 of API-equivalent value this month \(2\.0× the \$200\.00 plan\)/);
  assert.match(report, new RegExp(`\\| ${pseudonym('project', '/Users/dev/secret-client/app')} \\| 1 \\|`));
  assert.match(report, /- \*\*Repeated file reads\*\* × 1 · about \$0\.25 potential savings/);
  assert.doesNotMatch(report, /secret-client|keys\.js/);
  assert.match(report, /safe to share/);
});

test('weekly report with names includes project paths and insight details', () => {
  const report = buildWeeklyReport(reportSummary(), { showNames: true });
  assert.match(report, /\/Users\/dev\/secret-client\/app/);
  assert.match(report, /keys\.js was read 5 times \(about \$0\.25 potential\)/);
  assert.match(report, /includes project names/);
  assert.match(buildWeeklyReport({}), /No usage data is available yet/);
});

test('CLI report flags parse and validate', () => {
  const options = parseArgs(['--report', 'weekly.md', '--show-names']);
  assert.equal(options.reportPath, 'weekly.md');
  assert.equal(options.showNames, true);
  assert.throws(() => parseArgs(['--report', '-', '--json']), /choose only one output mode/);
  assert.throws(() => parseArgs(['--show-names']), /only applies to --report/);
});

test('GET /api/report serves the Markdown report as a download', async () => {
  const res = {
    headers: null,
    body: '',
    writeHead(statusCode, headers) { this.statusCode = statusCode; this.headers = headers; },
    end(body = '') { this.body += body; },
  };
  const store = { getSnapshot: () => ({ sessions: [], totalIngestedMessages: 0 }) };
  const req = Object.assign(new EventEmitter(), { method: 'GET' });
  assert.equal(await handleApiRoute(req, res, new URL('http://127.0.0.1/api/report'), store), true);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['Content-Type'], /^text\/markdown/);
  assert.match(res.headers['Content-Disposition'], /^attachment; filename="cc-token-meter-weekly-\d{4}-\d{2}-\d{2}\.md"$/);
  assert.match(res.body, /^# CC Token Meter weekly report/);
});

test('dashboard shows the weekly score and offers both report downloads', () => {
  const html = fs.readFileSync(path.join(publicDir, 'dashboard.html'), 'utf8');
  const js = fs.readFileSync(path.join(publicDir, 'dashboard.js'), 'utf8');
  assert.match(html, /id="efficiencyScore"/);
  assert.match(html, /id="downloadReport"/);
  assert.match(html, /id="downloadReportNames"/);
  assert.match(js, /fetch\('\/api\/report' \+ \(withNames \? '\?names=1' : ''\)/);
  assert.match(js, /renderEfficiency\(summary\.efficiency, summary\.week\)/);
});
