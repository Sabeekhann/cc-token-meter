import { buildSummary } from '../../server/summary.js';
import { createStore } from '../../ingest/store.js';

export async function summaryCommand({ cache = true, filters = {} } = {}) {
  const store = createStore({ persistIndex: cache });
  await store.ingestNewData();
  process.stdout.write(formatCompactSummary(buildSummary(store, { filters })));
}

export function formatCompactSummary(summary = {}) {
  const selected = summary.allTime || {};
  const today = summary.today || {};
  const intelligence = summary.intelligence || {};
  const active = intelligence.active || {};
  const velocity = intelligence.velocity || {};
  const cache = intelligence.cache || {};
  const quality = intelligence.dataQuality || {};
  const topProject = Array.isArray(summary.byProject) ? summary.byProject[0] : null;
  const tips = Array.isArray(summary.tips) ? summary.tips : [];
  const warningCount = tips.filter((tip) => tip && tip.severity === 'warn').length;

  const lines = [
    'cc-token-meter summary',
    `Scope: ${formatScope(summary.filters || {})}`,
    `Selected: ${formatTokens(selected.tokenTotal)} tokens · ${formatCost(selected.costUsd)}`,
    `Today: ${formatTokens(today.tokenTotal)} tokens · ${formatCost(today.costUsd)}`,
    formatMonthLine(summary.month, summary.config || {}),
    `Active: ${integer(active.sessionCount)} session${integer(active.sessionCount) === 1 ? '' : 's'} · ${formatTokens(velocity.tokensPerMinute)}/min · ${formatCost(velocity.costPerHour)}/hour`,
    `Cache: ${formatPercent(cache.reuseRate)} reuse · ${formatCost(cache.estimatedSavingsUsd)} estimated input cost avoided`,
    topProject
      ? `Top project: ${shortProject(topProject.project)} · ${formatTokens(topProject.tokenTotal)} tokens · ${formatCost(topProject.costUsd)}`
      : 'Top project: no usage in the selected scope',
    `Recommendations: ${tips.length} active · ${warningCount} need${warningCount === 1 ? 's' : ''} attention`,
    `Pricing quality: ${integer(quality.exactCostMessageCount)}/${integer(quality.messageCount)} messages matched known pricing · verified ${summary.pricing?.verifiedOn || 'unknown'}`,
  ];

  const whatIf = summary.whatIf && summary.whatIf.scope;
  if (whatIf && whatIf.actualCostUsd > 0 && Array.isArray(whatIf.costs) && whatIf.costs.length > 0) {
    const options = whatIf.costs
      .map((cost) => `${cost.label} ${formatCost(cost.costUsd)} (${formatSignedPercent(cost.deltaRatio)})`)
      .join(' · ');
    lines.push(`What-if, same tokens: ${options} vs ${formatCost(whatIf.actualCostUsd)} actual`);
  }

  const plan = summary.plan;
  if (plan && plan.plan && plan.plan !== 'api') lines.push(formatPlanLine(plan));

  return `${lines.join('\n')}\n`;
}

function formatPlanLine(plan) {
  const block = plan.currentBlock;
  const windowText = block
    ? `5h window ${formatTokens(block.tokenTotal)} tokens${typeof block.ratio === 'number' ? ` (${formatPercent(block.ratio)} of your ${block.referenceKind === 'limit' ? 'limit' : 'largest window'})` : ''}, resets in ${integer(block.remainingMinutes)} min`
    : '5h window idle';
  const value = plan.apiValue || {};
  const multiple = typeof value.multipleOfPlan === 'number'
    ? ` (${value.multipleOfPlan >= 1 ? `${value.multipleOfPlan.toFixed(1)}x` : `${formatPercent(value.multipleOfPlan)} of`} the ${formatCost(value.planMonthlyUsd)} plan)`
    : '';
  return `Plan: ${plan.planLabel} · ${windowText} · ${formatCost(value.monthToDateUsd)} API-equivalent this month${multiple}`;
}

function formatSignedPercent(ratio) {
  const value = Math.round(numberOr0(ratio) * 100);
  return value > 0 ? `+${value}%` : `${value}%`;
}

function formatMonthLine(month, config) {
  if (!month || !month.month) return `Month: no usage yet`;
  const base = `Month (${month.month}): ${formatTokens(month.tokenTotal)} tokens · ${formatCost(month.costUsd)}`;
  if (config.monthlyCostCapUsd > 0) {
    return `${base} · ${formatPercent(month.costUsd / config.monthlyCostCapUsd)} of ${formatCost(config.monthlyCostCapUsd)} budget · on pace for ${formatCost(month.projectedCostUsd)}`;
  }
  if (config.monthlyTokenCap > 0) {
    return `${base} · ${formatPercent(month.tokenTotal / config.monthlyTokenCap)} of ${formatTokens(config.monthlyTokenCap)}-token budget · on pace for ${formatTokens(month.projectedTokens)} tokens`;
  }
  return `${base} · on pace for ${formatCost(month.projectedCostUsd)}`;
}

function formatScope(filters) {
  const parts = [];
  if (filters.from || filters.to) {
    parts.push(`${filters.from || 'beginning'} to ${filters.to || 'today'}`);
  }
  if (filters.project) parts.push(`project contains "${filters.project}"`);
  if (filters.model) parts.push(`model is "${filters.model}"`);
  return parts.length > 0 ? parts.join(' · ') : 'all local history';
}

function formatTokens(value) {
  return Math.round(numberOr0(value)).toLocaleString('en-US');
}

function formatCost(value) {
  return `$${numberOr0(value).toFixed(2)}`;
}

function formatPercent(value) {
  return `${Math.round(numberOr0(value) * 100)}%`;
}

function integer(value) {
  return Math.max(0, Math.round(numberOr0(value)));
}

function numberOr0(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function shortProject(value) {
  const raw = String(value || 'unknown');
  const parts = raw.split(/[\\/]/).filter(Boolean);
  if (parts.length === 0) return 'unknown';
  return parts.length === 1 ? parts[0] : parts.slice(-2).join('/');
}
