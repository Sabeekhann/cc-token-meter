import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(testDir, '..', 'public');

test('dashboard exposes the five v2 task views and functional controls', () => {
  const html = fs.readFileSync(path.join(publicDir, 'dashboard.html'), 'utf8');

  for (const view of ['overview', 'live', 'projects', 'insights', 'settings']) {
    assert.match(html, new RegExp(`data-view="${view}"`));
    assert.match(html, new RegExp(`data-view-panel="${view}"`));
  }

  assert.match(html, /id="projectSearch"/);
  assert.match(html, /id="projectModel"/);
  assert.match(html, /id="projectFrom"/);
  assert.match(html, /id="projectTo"/);
  assert.match(html, /id="clearProjectFilters"/);
  assert.match(html, /data-project-range="7d"/);
  assert.match(html, /data-project-range="30d"/);
  assert.match(html, /data-project-range="90d"/);
  assert.match(html, /data-project-range="custom"/);
  assert.match(html, /id="projectFilterSummary"[^>]+aria-live="polite"/);
  assert.match(html, /id="budgetForm"/);
  assert.match(html, /data-insight-filter="warn"/);
  assert.match(html, /id="liveSessionContent"/);
  assert.match(html, /usage-index-v3\.json/);
  assert.match(html, /id="pricingVerifiedOn"/);
});

test('dashboard assets remain fully local and connect only to local API paths', () => {
  const html = fs.readFileSync(path.join(publicDir, 'dashboard.html'), 'utf8');
  const css = fs.readFileSync(path.join(publicDir, 'dashboard.css'), 'utf8');
  const js = fs.readFileSync(path.join(publicDir, 'dashboard.js'), 'utf8');

  assert.doesNotMatch(html, /https?:\/\//i);
  assert.doesNotMatch(css, /https?:\/\//i);
  assert.doesNotMatch(js, /fetch\(['"]https?:\/\//i);
  assert.match(js, /fetch\('\/api\/summary'/);
  assert.match(js, /fetch\('\/api\/summary\?' \+ filterKey/);
  assert.match(js, /new URLSearchParams\(window\.location\.search\)/);
  assert.match(js, /history\.replaceState\(null, '', url\.pathname \+ url\.search \+ url\.hash\)/);
  assert.match(js, /view === 'projects' && state\.summary && projectFiltersActive\(\) && !state\.projectSummary/);
  assert.match(js, /requestId !== state\.projectRequestId/);
  assert.match(js, /projectSummaryKey/);
  assert.match(js, /projectScopePending/);
  assert.match(js, /state\.projectSummaryKey = null/);
  assert.match(js, /state\.projectSummaryKey = filterKey/);
  assert.match(js, /fetch\('\/api\/budget'/);
  assert.match(js, /new EventSource\('\/api\/stream'\)/);
});
