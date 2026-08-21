/**
 * Pricing table for Claude models, used to estimate cost of local token
 * usage. Figures are current as of 2026-08-21, sourced from
 * https://platform.claude.com/docs (pricing pages) — re-verify against that
 * source before any future release if this table has gone stale, since
 * Anthropic revises pricing periodically. Anthropic made Sonnet 5's launch
 * rate permanent and cancelled the previously announced 2026-09-01 increase.
 *
 * All figures are USD per million tokens (MTok), base input/output rates
 * only. Cache pricing is NOT hardcoded per row — it's derived from these
 * base input rates using fixed multipliers that are consistent across all
 * current models:
 *
 *   - 5-minute cache write = 1.25x base input rate
 *   - 1-hour cache write   = 2.0x  base input rate
 *   - cache read           = 0.1x  base input rate
 *
 * Each row is matched against `message.model` by substring (normalized,
 * lowercased), NOT exact equality, since exact model id strings vary/evolve
 * (dates, minor versions get appended). Rows are optionally bounded by
 * `effectiveFrom` / `effectiveUntil` (ISO date strings, inclusive lower
 * bound / exclusive-or-inclusive upper bound — see cost.js for exact
 * comparison semantics) so historical costs remain accurate after a price
 * change ships.
 */

export const CACHE_WRITE_5M_MULTIPLIER = 1.25;
export const CACHE_WRITE_1H_MULTIPLIER = 2.0;
export const CACHE_READ_MULTIPLIER = 0.1;
export const PRICING_VERIFIED_ON = '2026-08-21';

/**
 * Order matters only in that more specific rows should be listed before
 * more general fallback rows if substrings could overlap. Substrings here
 * are distinct enough (opus/sonnet/haiku + version numbers) that ordering
 * doesn't currently create ambiguity, but `matchModelRow` in cost.js always
 * picks the FIRST row whose substring matches, so keep more-specific rows
 * earlier if this table grows.
 */
export const PRICING_TABLE = [
  // Opus 5 and recent Opus 4.x minor versions
  {
    id: 'opus-5-and-recent-4x',
    matchSubstrings: ['opus-5', 'opus-4.8', 'opus-4.7', 'opus-4.6', 'opus-4.5', 'opus5'],
    inputPerMTok: 5.0,
    outputPerMTok: 25.0,
    effectiveFrom: null,
    effectiveUntil: null,
  },
  // Deprecated older/higher-priced Opus versions
  {
    id: 'opus-4.1-and-4',
    matchSubstrings: ['opus-4.1', 'opus-4-', 'opus-4"', 'opus-4.0'],
    inputPerMTok: 15.0,
    outputPerMTok: 75.0,
    effectiveFrom: null,
    effectiveUntil: null,
  },
  // Sonnet 5 launch pricing is now the standard rate; the previously
  // scheduled 2026-09-01 increase was cancelled by Anthropic.
  {
    id: 'sonnet-5',
    matchSubstrings: ['sonnet-5', 'sonnet5'],
    inputPerMTok: 2.0,
    outputPerMTok: 10.0,
    effectiveFrom: null,
    effectiveUntil: null,
  },
  // Sonnet 4.6 / 4.5 (no scheduled change baked in — same rate throughout)
  {
    id: 'sonnet-4.6-4.5',
    matchSubstrings: ['sonnet-4.6', 'sonnet-4.5'],
    inputPerMTok: 3.0,
    outputPerMTok: 15.0,
    effectiveFrom: null,
    effectiveUntil: null,
  },
  {
    id: 'haiku-4.5',
    matchSubstrings: ['haiku-4.5'],
    inputPerMTok: 1.0,
    outputPerMTok: 5.0,
    effectiveFrom: null,
    effectiveUntil: null,
  },
  // Deprecated
  {
    id: 'haiku-3.5',
    matchSubstrings: ['haiku-3.5'],
    inputPerMTok: 0.8,
    outputPerMTok: 4.0,
    effectiveFrom: null,
    effectiveUntil: null,
  },
];

/**
 * Fallback row used when no table entry matches `message.model` by
 * substring. Chosen as a conservative Sonnet-tier rate since Sonnet is
 * the most commonly used tier. Any cost computed via this fallback should
 * be flagged with `estimated: true` / `usedFallback: true` by the caller.
 */
export const FALLBACK_ROW = {
  id: 'fallback-sonnet',
  matchSubstrings: [],
  inputPerMTok: 3.0,
  outputPerMTok: 15.0,
  effectiveFrom: null,
  effectiveUntil: null,
};
