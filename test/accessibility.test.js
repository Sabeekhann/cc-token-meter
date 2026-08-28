import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(testDir, '..');
const html = fs.readFileSync(path.join(rootDir, 'public', 'dashboard.html'), 'utf8');
const css = fs.readFileSync(path.join(rootDir, 'public', 'dashboard.css'), 'utf8');
const js = fs.readFileSync(path.join(rootDir, 'public', 'dashboard.js'), 'utf8');
const aggregate = fs.readFileSync(path.join(rootDir, 'src', 'ingest', 'aggregate.js'), 'utf8');

test('dashboard has semantic landmarks, a skip link, and labeled controls', () => {
  assert.match(html, /class="skip-link" href="#mainContent"/);
  assert.match(html, /<aside[^>]+aria-label="Primary navigation"/);
  assert.match(html, /<nav[^>]+aria-label="Dashboard views"/);
  assert.match(html, /<main id="mainContent"/);
  assert.match(html, /<h1 id="viewTitle" tabindex="-1">/);

  for (const id of ['projectSearch', 'dailyTokenCap', 'dailyCostCapUsd', 'sessionCostCapUsd', 'warnThresholdPct']) {
    assert.match(html, new RegExp(`<label[\\s\\S]*?<input id="${id}"`));
  }
  assert.match(html, /<label class="explorer-field model-field">[\s\S]*?<select id="projectModel"/);
  assert.match(html, /<label class="explorer-field">[\s\S]*?<input id="projectFrom"/);
  assert.match(html, /<label class="explorer-field">[\s\S]*?<input id="projectTo"/);
  assert.match(html, /id="projectFilterSummary"[^>]+aria-live="polite"/);
  assert.match(js, /<label><span class="sr-only">Select session<\/span><select id="sessionPicker"/);
});

test('keyboard interaction covers navigation, filters, expandable rows, and session links', () => {
  for (const key of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End']) {
    assert.match(js, new RegExp(`key === '${key}'`));
  }
  assert.match(js, /panel\.hidden = !active/);
  assert.match(js, /setAttribute\('aria-pressed'/);
  assert.match(js, /aria-expanded="' \+ expanded \+ '"/);
  assert.match(js, /class="session-button" type="button" data-view-session/);
});

test('focus and interactive target styles meet the 44 CSS-pixel contract', () => {
  assert.match(css, /focus-visible[^\{]*\{[^}]*outline:3px solid #3959dc/s);
  for (const selector of ['secondary-button', 'primary-button', 'metric-link', 'text-button', 'session-picker', 'search-field', 'filter-button', 'session-button', 'range-button', 'clear-filter-button']) {
    assert.match(css, new RegExp(`\\.${selector}[^\\{]*\\{[^}]*min-height:44px`, 's'));
  }
  assert.match(css, /\.form-grid input[^\{]*\{[^}]*height:44px/s);
  assert.match(css, /\.explorer-field select,\.explorer-field input[^\{]*\{[^}]*min-height:44px/s);
});

test('responsive rules cover the 1440, 1024, 768, and 390 pixel matrix', () => {
  assert.match(css, /@media \(max-width:1180px\)/);
  assert.match(css, /@media \(max-width:900px\)/);
  assert.match(css, /@media \(max-width:680px\)/);
  assert.match(css, /\.metric-grid \{ grid-template-columns:1fr; \}/);
  assert.match(css, /\.branch-grid \{ grid-template-columns:1fr; \}/);
  assert.match(css, /\.burn-chart \{ min-height:190px;overflow-x:auto; \}/);
  assert.match(css, /\.projects-explorer \{ display:grid;grid-template-columns:1fr;margin-top:0; \}/);
  assert.match(css, /\.nav-list \{ display:grid;grid-template-columns:repeat\(5,minmax\(0,1fr\)\);/);
  assert.match(css, /\.table-head>\*:nth-child\(2\),\.project-table-row>\*:nth-child\(2\) \{ display:none; \}/);
  assert.match(css, /\.project-table-row>\*:nth-child\(3\) \{ grid-area:tokens;display:block; \}/);
  assert.match(css, /\.project-table-row>\*:nth-child\(4\) \{ grid-area:cost;display:block;text-align:right; \}/);
});

test('functional secondary text uses the strengthened readable palette', () => {
  assert.match(css, /--muted:#5f6b82;/);
  assert.match(css, /--faint:#657087;/);
  assert.match(css, /\.table-head[^\{]*\{[^}]*font-size:10\.5px/s);
  assert.match(css, /\.explorer-field[^\{]*\{[^}]*font-size:10\.5px/s);
  assert.match(css, /\.empty-state\.compact[^\{]*\{[^}]*font-size:12px/s);
});

test('charts have text summaries and histories stay bounded', () => {
  assert.match(html, /id="burnChartSummary" class="chart-summary"/);
  assert.match(js, /days\.length \+ ' days shown: '/);
  assert.match(js, /messages shown, ' \+ formatNumber\(running\)/);
  assert.match(js, /slice\(-14\)/);
  assert.match(aggregate, /const TIMELINE_MAX_POINTS = 500/);
});

test('empty, disconnected, fallback-pricing, and local-only states remain explicit', () => {
  assert.match(js, /No sessions yet/);
  assert.match(js, /setConnection\('disconnected', 'Reconnecting'\)/);
  assert.match(js, /setConnection\('disconnected', 'Invalid local data'\)/);
  assert.match(js, /Fallback estimate used/);
  assert.doesNotMatch(html + css, /https?:\/\//i);
  assert.doesNotMatch(js, /fetch\(['"]https?:\/\//i);
});
