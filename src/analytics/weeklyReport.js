// Copyright 2026 FiveNodes
// SPDX-License-Identifier: Apache-2.0

import { localDateKey } from '../ingest/aggregate.js';

const TIP_LABELS = {
  repeatedReads: 'Repeated file reads',
  cacheRatio: 'Cache reuse dropped',
  longSessionNoCompact: 'Context needs attention',
  outlierSessionTotal: 'Unusually large session',
  largeToolResultSpike: 'Large tool output',
};

/**
 * Render the weekly digest as Markdown from a buildSummary() result.
 *
 * Shareable by default: project names become stable pseudonyms and
 * recommendations are listed by category, because their messages can name
 * local files. `showNames` includes real project paths and messages for a
 * private copy.
 *
 * @param {object} summary buildSummary() output (uses week, efficiency, plan, tips, hiddenTips, pricing)
 * @param {{showNames?: boolean}} [options]
 */
export function buildWeeklyReport(summary, { showNames = false } = {}) {
  const week = summary.week;
  const efficiency = summary.efficiency || {};
  const lines = [];
  if (!week) return '# CC Token Meter weekly report\n\nNo usage data is available yet.\n';

  lines.push(`# CC Token Meter weekly report`);
  lines.push('');
  lines.push(`**${formatDate(week.start)} – ${formatDate(week.end)}** · generated locally from Claude Code transcripts`);
  lines.push('');

  lines.push('## Efficiency score');
  lines.push('');
  if (typeof efficiency.score === 'number') {
    lines.push(`**${efficiency.score}/100**`);
    lines.push('');
    lines.push('| Component | Points | Detail |');
    lines.push('| --- | ---: | --- |');
    for (const item of efficiency.components || []) {
      lines.push(`| ${item.label} | ${item.points}/${item.max} | ${escapeCell(item.detail)} |`);
    }
    if (efficiency.suggestion) {
      lines.push('');
      lines.push(`**Biggest opportunity:** ${efficiency.suggestion}`);
    }
  } else {
    lines.push('No usage this week, so there is nothing to score.');
  }
  lines.push('');

  const current = week.current;
  const previous = week.previous;
  lines.push('## Usage');
  lines.push('');
  lines.push('| | This week | Previous week | Change |');
  lines.push('| --- | ---: | ---: | ---: |');
  lines.push(`| Tokens | ${formatInteger(current.tokenTotal)} | ${formatInteger(previous.tokenTotal)} | ${formatChange(current.tokenTotal, previous.tokenTotal)} |`);
  lines.push(`| Estimated cost | ${formatCost(current.costUsd)} | ${formatCost(previous.costUsd)} | ${formatChange(current.costUsd, previous.costUsd)} |`);
  lines.push(`| Messages | ${formatInteger(current.messageCount)} | ${formatInteger(previous.messageCount)} | ${formatChange(current.messageCount, previous.messageCount)} |`);
  lines.push(`| Cache reuse | ${formatPercent(reuse(current))} | ${formatPercent(reuse(previous))} | |`);
  lines.push('');

  const plan = summary.plan;
  if (plan && plan.plan && plan.plan !== 'api' && plan.apiValue) {
    const multiple = typeof plan.apiValue.multipleOfPlan === 'number'
      ? ` (${plan.apiValue.multipleOfPlan.toFixed(1)}× the ${formatCost(plan.apiValue.planMonthlyUsd)} plan)`
      : '';
    lines.push(`**${plan.planLabel} plan:** ${formatCost(plan.apiValue.monthToDateUsd)} of API-equivalent value this month${multiple}.`);
    lines.push('');
  }

  lines.push('### By day');
  lines.push('');
  lines.push('| Day | Tokens | Estimated cost |');
  lines.push('| --- | ---: | ---: |');
  for (const day of week.byDay || []) {
    lines.push(`| ${formatDate(day.date)} | ${formatInteger(day.tokenTotal)} | ${formatCost(day.costUsd)} |`);
  }
  lines.push('');

  if ((week.models || []).length > 0) {
    lines.push('### Models');
    lines.push('');
    lines.push('| Model | Tokens | Estimated cost |');
    lines.push('| --- | ---: | ---: |');
    for (const model of week.models.slice(0, 6)) {
      lines.push(`| ${escapeCell(model.model)} | ${formatInteger(model.tokenTotal)} | ${formatCost(model.costUsd)} |`);
    }
    lines.push('');
  }

  if ((week.projects || []).length > 0) {
    lines.push('### Top projects');
    lines.push('');
    lines.push('| Project | Sessions | Tokens | Estimated cost |');
    lines.push('| --- | ---: | ---: | ---: |');
    for (const project of week.projects.slice(0, 5)) {
      const name = showNames ? project.project : pseudonym('project', project.project);
      lines.push(`| ${escapeCell(name)} | ${project.sessionCount} | ${formatInteger(project.tokenTotal)} | ${formatCost(project.costUsd)} |`);
    }
    lines.push('');
  }

  const weekSessionIds = new Set((summary.sessions || [])
    .filter((session) => session.lastTimestamp && (week.activeDates || []).includes(localDateKey(session.lastTimestamp)))
    .map((session) => session.sessionId));
  const tips = [...(summary.tips || []), ...(summary.hiddenTips || [])].filter((tip) => weekSessionIds.has(tip.sessionId));
  lines.push('## Recommendations');
  lines.push('');
  if (tips.length === 0) {
    lines.push('No recommendations for this week’s sessions.');
  } else if (showNames) {
    for (const tip of tips.slice(0, 10)) {
      lines.push(`- **${tipLabel(tip)}** — ${tip.message}${savings(tip)}`);
    }
  } else {
    const grouped = new Map();
    for (const tip of tips) {
      const label = tipLabel(tip);
      const bucket = grouped.get(label) || { count: 0, usd: 0 };
      bucket.count += 1;
      bucket.usd += Number.isFinite(tip.estimatedSavingsUsd) ? tip.estimatedSavingsUsd : 0;
      grouped.set(label, bucket);
    }
    for (const [label, bucket] of grouped) {
      lines.push(`- **${label}** × ${bucket.count}${bucket.usd > 0 ? ` · about ${formatCost(bucket.usd)} potential savings` : ''}`);
    }
  }
  lines.push('');

  lines.push('---');
  lines.push('');
  const verified = summary.pricing && summary.pricing.verifiedOn ? ` (pricing verified ${summary.pricing.verifiedOn})` : '';
  lines.push(`_Costs are local estimates${verified}, not an Anthropic bill. ${showNames ? 'This copy includes project names and recommendation details.' : 'Project names are pseudonymized and recommendation details omitted, so this report is safe to share.'} Generated by [cc-token-meter](https://github.com/Sabeekhann/cc-token-meter)._`);
  return `${lines.join('\n')}\n`;
}

/**
 * Stable, non-reversible-at-a-glance label for a name (FNV-1a). It hides
 * names from casual readers; it is not meant to resist a determined guess.
 */
export function pseudonym(prefix, value) {
  let hash = 0x811c9dc5;
  for (const char of String(value)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${prefix}-${hash.toString(16).padStart(8, '0').slice(0, 6)}`;
}

function tipLabel(tip) {
  const prefix = String(tip.id || '').split(':')[0];
  return TIP_LABELS[prefix] || 'Usage opportunity';
}

function savings(tip) {
  return Number.isFinite(tip.estimatedSavingsUsd) && tip.estimatedSavingsUsd > 0
    ? ` (about ${formatCost(tip.estimatedSavingsUsd)} potential)`
    : '';
}

function reuse(totals) {
  const prompt = totals.inputTokens + totals.cacheCreationInputTokens + totals.cacheReadInputTokens;
  return prompt > 0 ? totals.cacheReadInputTokens / prompt : null;
}

function formatDate(key) {
  const date = new Date(`${key}T12:00:00`);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    : String(key);
}

function formatChange(current, previous) {
  if (!(previous > 0)) return current > 0 ? 'new' : '—';
  const change = (current - previous) / previous;
  const sign = change > 0 ? '+' : '';
  return `${sign}${Math.round(change * 100)}%`;
}

function formatInteger(value) {
  return Math.round(Number.isFinite(value) ? value : 0).toLocaleString('en-US');
}

function formatCost(value) {
  return `$${(Number.isFinite(value) ? value : 0).toFixed(2)}`;
}

function formatPercent(value) {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

function escapeCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
}
