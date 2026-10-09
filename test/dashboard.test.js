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

test('dashboard ships an offline dark theme, command palette, and new usage visuals', () => {
  const html = fs.readFileSync(path.join(publicDir, 'dashboard.html'), 'utf8');
  const css = fs.readFileSync(path.join(publicDir, 'dashboard.css'), 'utf8');
  const js = fs.readFileSync(path.join(publicDir, 'dashboard.js'), 'utf8');

  assert.match(html, /<meta name="color-scheme" content="light dark" \/>/);
  assert.match(css, /@media \(prefers-color-scheme:dark\)/);
  assert.match(css, /:root\[data-theme="dark"\]/);
  assert.match(html, /id="themeToggle"/);
  assert.match(js, /window\.localStorage\.getItem\(THEME_KEY\)/);
  // Storage can be unavailable (private mode, blocked site data); theme
  // persistence must never break rendering.
  assert.match(js, /try \{\s*window\.localStorage\.setItem\(THEME_KEY, next\);\s*\} catch/);

  assert.match(html, /id="paletteBackdrop"[^>]*>\s*<div class="palette" role="dialog" aria-modal="true"/);
  assert.match(html, /id="paletteInput"[^>]+role="combobox"/);
  assert.match(js, /event\.metaKey \|\| event\.ctrlKey\) && !event\.altKey && String\(event\.key\)\.toLowerCase\(\) === 'k'/);
  assert.match(js, /isTypingTarget\(event\.target\)/);

  assert.match(html, /id="usageHeatmap"[^>]+aria-describedby="heatmapSummary"/);
  assert.match(html, /id="heatmapSummary" class="chart-summary"/);
  assert.match(html, /id="tokenSpark"/);
  assert.match(html, /id="costSpark"/);
  assert.match(js, /renderContextGauge\(session\)/);
  assert.match(js, /estimateBadge\(project\.estimatedCostUsed\)/);
  assert.match(js, /estimateBadge\(session\.estimatedCostUsed\)/);
});

test('dashboard shows subscription windows only for plan users and saves plan settings', () => {
  const html = fs.readFileSync(path.join(publicDir, 'dashboard.html'), 'utf8');
  const js = fs.readFileSync(path.join(publicDir, 'dashboard.js'), 'utf8');

  assert.match(html, /id="planPanel" class="panel plan-panel hidden"/);
  assert.match(html, /<label>[\s\S]*?<select id="planSelect" name="plan">/);
  for (const id of ['planMonthlyUsd', 'blockTokenLimit', 'weeklyTokenLimit']) {
    assert.match(html, new RegExp(`<label>[\\s\\S]*?<input id="${id}"`));
  }
  assert.match(js, /var subscribed = plan && plan\.plan && plan\.plan !== 'api';/);
  assert.match(js, /panel\.classList\.toggle\('hidden', !subscribed\)/);
  assert.match(js, /plan: byId\('planSelect'\)\.value/);
  // Anthropic publishes no plan token limits; the UI must say progress is local.
  assert.match(html, /Anthropic doesn't publish plan token limits/);
});
