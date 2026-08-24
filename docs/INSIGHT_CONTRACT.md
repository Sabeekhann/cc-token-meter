# Insight contract

Every heuristic recommendation emitted by cc-token-meter follows insight contract version 1. The contract makes the boundary between observed local facts and estimates explicit while keeping the original dashboard and CLI fields compatible.

```json
{
  "contractVersion": 1,
  "id": "repeatedReads:session:file",
  "sessionId": "session",
  "severity": "info",
  "message": "Human-readable explanation",
  "action": "Concrete next step",
  "scope": { "type": "file", "id": "session:file", "label": "file" },
  "confidence": {
    "level": "high",
    "score": 0.95,
    "basis": "Why this signal is reliable"
  },
  "evidence": [
    { "metric": "read_count", "value": 4, "unit": "reads", "kind": "measured" }
  ],
  "estimatedSavingsTokens": 3000,
  "estimatedSavingsUsd": 0.01,
  "savings": {
    "kind": "estimated",
    "tokens": 3000,
    "usd": 0.01,
    "basis": "How the estimate was calculated"
  }
}
```

## Required fields

- `severity` is `warn` or `info`.
- `evidence` contains at least one local observation. Each item is explicitly `measured` or `estimated`.
- `confidence` contains a level, a score from 0 through 1, and a plain-language basis.
- `action` is a concrete recommendation.
- `scope` identifies the affected session, file, or tool result.
- `savings` appears only when both token and USD savings can be calculated. Savings are estimates and always include their basis.

The legacy `message`, `estimatedSavingsTokens`, and `estimatedSavingsUsd` fields remain available. When savings cannot be calculated honestly, the two legacy values are `null` and the structured `savings` field is omitted.

## Ranking and deduplication

Insights are ordered deterministically by severity, calculable USD savings, confidence score, and stable id. When multiple insights recommend the same action for the same scope, only the highest-ranked insight is returned.

## Privacy and rendering

The contract contains derived metrics and local scope labels only; it does not add transcript content. The dashboard escapes insight messages and labels before rendering. No insight processing uses a remote service.
