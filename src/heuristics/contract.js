const SEVERITY_RANK = Object.freeze({ warn: 2, info: 1 });
const CONFIDENCE_LEVELS = new Set(['low', 'medium', 'high']);
const EVIDENCE_KINDS = new Set(['measured', 'estimated']);

/**
 * Build the v1 insight contract while retaining the legacy fields consumed by
 * the CLI JSON response and dashboard. `savings` is deliberately omitted when
 * the heuristic cannot calculate it honestly; the legacy nullable savings
 * fields remain until a future breaking release.
 */
export function createInsight({
  id,
  sessionId,
  severity,
  message,
  action,
  scope,
  confidence,
  evidence,
  savings,
}) {
  const insight = {
    contractVersion: 1,
    id,
    sessionId,
    severity,
    message,
    action,
    scope,
    confidence,
    evidence,
    estimatedSavingsTokens: savings ? savings.tokens : null,
    estimatedSavingsUsd: savings ? savings.usd : null,
  };

  if (savings) insight.savings = savings;
  assertInsightContract(insight);
  return insight;
}

/** Throw early if a heuristic emits an incomplete or misleading insight. */
export function assertInsightContract(insight) {
  if (!insight || typeof insight !== 'object') throw new TypeError('Insight must be an object');
  if (insight.contractVersion !== 1) throw new TypeError('Insight contractVersion must be 1');
  for (const field of ['id', 'sessionId', 'severity', 'message', 'action']) {
    if (typeof insight[field] !== 'string' || insight[field].trim() === '') {
      throw new TypeError(`Insight ${field} must be a non-empty string`);
    }
  }
  if (!(insight.severity in SEVERITY_RANK)) throw new TypeError('Insight severity must be info or warn');
  if (!insight.scope || typeof insight.scope.type !== 'string' || typeof insight.scope.id !== 'string') {
    throw new TypeError('Insight scope must contain string type and id fields');
  }
  if (
    !insight.confidence ||
    !CONFIDENCE_LEVELS.has(insight.confidence.level) ||
    !Number.isFinite(insight.confidence.score) ||
    insight.confidence.score < 0 ||
    insight.confidence.score > 1 ||
    typeof insight.confidence.basis !== 'string'
  ) {
    throw new TypeError('Insight confidence must contain level, score, and basis');
  }
  if (!Array.isArray(insight.evidence) || insight.evidence.length === 0) {
    throw new TypeError('Insight evidence must be a non-empty array');
  }
  for (const item of insight.evidence) {
    if (
      !item ||
      typeof item.metric !== 'string' ||
      !EVIDENCE_KINDS.has(item.kind) ||
      !('value' in item)
    ) {
      throw new TypeError('Each evidence item must contain metric, value, and measured/estimated kind');
    }
  }
  if (insight.savings) {
    if (
      insight.savings.kind !== 'estimated' ||
      !Number.isFinite(insight.savings.tokens) ||
      insight.savings.tokens < 0 ||
      !Number.isFinite(insight.savings.usd) ||
      insight.savings.usd < 0 ||
      typeof insight.savings.basis !== 'string'
    ) {
      throw new TypeError('Insight savings must be a non-negative estimated value with a basis');
    }
  }
  return insight;
}

/**
 * Rank warnings, larger calculable savings, and higher-confidence signals
 * first. Duplicate scope/action pairs collapse to the highest-ranked insight;
 * the final id tie-break makes output stable across discovery order.
 */
export function rankAndDedupeInsights(insights) {
  const ranked = insights.slice().sort(compareInsights);
  const seen = new Set();
  const result = [];

  for (const insight of ranked) {
    assertInsightContract(insight);
    const key = `${insight.scope.type}:${insight.scope.id}\u0000${insight.action}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(insight);
  }
  return result;
}

function compareInsights(a, b) {
  const severityDelta = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
  if (severityDelta !== 0) return severityDelta;

  const savingsDelta = finiteOrZero(b.estimatedSavingsUsd) - finiteOrZero(a.estimatedSavingsUsd);
  if (savingsDelta !== 0) return savingsDelta;

  const confidenceDelta = b.confidence.score - a.confidence.score;
  if (confidenceDelta !== 0) return confidenceDelta;
  return a.id.localeCompare(b.id);
}

function finiteOrZero(value) {
  return Number.isFinite(value) ? value : 0;
}
