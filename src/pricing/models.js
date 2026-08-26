// Copyright 2026 FiveNodes
// SPDX-License-Identifier: Apache-2.0

/**
 * Pricing table for Claude models, used to estimate cost of local token
 * usage. Figures are current as of 2026-08-26 and sourced from Anthropic's
 * official model/pricing documentation. Re-verify before future releases;
 * model availability and pricing can change.
 *
 * All figures are USD per million tokens (MTok), base input/output rates.
 * Cache pricing is derived from the base input rate with Anthropic's standard
 * prompt-caching multipliers:
 *
 *   - 5-minute cache write = 1.25x base input rate
 *   - 1-hour cache write   = 2.0x base input rate
 *   - cache read           = 0.1x base input rate
 *
 * Model IDs from Claude 4.6 onward use hyphen-separated, dateless identifiers
 * such as `claude-opus-4-8`. Older models commonly include a snapshot date,
 * such as `claude-sonnet-4-5-20250929`. Keep the canonical hyphenated forms
 * here; dot-separated variants remain as compatibility matches for any legacy
 * normalized data that may already exist locally.
 */

export const CACHE_WRITE_5M_MULTIPLIER = 1.25;
export const CACHE_WRITE_1H_MULTIPLIER = 2.0;
export const CACHE_READ_MULTIPLIER = 0.1;
export const PRICING_VERIFIED_ON = '2026-08-26';

/**
 * `matchModelRow` selects the first matching row, so specific model families
 * must appear before broader historical fallbacks.
 */
export const PRICING_TABLE = [
  {
    id: 'fable-mythos-5',
    matchSubstrings: ['fable-5', 'fable5', 'mythos-5', 'mythos5'],
    inputPerMTok: 10.0,
    outputPerMTok: 50.0,
    effectiveFrom: null,
    effectiveUntil: null,
  },
  {
    id: 'opus-5-and-recent-4x',
    matchSubstrings: [
      'opus-5',
      'opus5',
      'opus-4-8',
      'opus-4-7',
      'opus-4-6',
      'opus-4-5',
      'opus-4.8',
      'opus-4.7',
      'opus-4.6',
      'opus-4.5',
    ],
    inputPerMTok: 5.0,
    outputPerMTok: 25.0,
    effectiveFrom: null,
    effectiveUntil: null,
  },
  {
    id: 'opus-4.1-and-4',
    matchSubstrings: [
      'opus-4-1',
      'opus-4.1',
      'opus-4-20250514',
      'opus-4-',
      'opus-4"',
      'opus-4.0',
    ],
    inputPerMTok: 15.0,
    outputPerMTok: 75.0,
    effectiveFrom: null,
    effectiveUntil: null,
  },
  {
    id: 'opus-3',
    matchSubstrings: ['3-opus', 'opus-3'],
    inputPerMTok: 15.0,
    outputPerMTok: 75.0,
    effectiveFrom: null,
    effectiveUntil: null,
  },
  {
    id: 'sonnet-5',
    matchSubstrings: ['sonnet-5', 'sonnet5'],
    inputPerMTok: 2.0,
    outputPerMTok: 10.0,
    effectiveFrom: null,
    effectiveUntil: null,
  },
  {
    id: 'sonnet-4x',
    matchSubstrings: [
      'sonnet-4-6',
      'sonnet-4-5',
      'sonnet-4-20250514',
      'sonnet-4.6',
      'sonnet-4.5',
    ],
    inputPerMTok: 3.0,
    outputPerMTok: 15.0,
    effectiveFrom: null,
    effectiveUntil: null,
  },
  {
    id: 'sonnet-3x',
    matchSubstrings: ['3-7-sonnet', '3-5-sonnet', 'sonnet-3.7', 'sonnet-3.5'],
    inputPerMTok: 3.0,
    outputPerMTok: 15.0,
    effectiveFrom: null,
    effectiveUntil: null,
  },
  {
    id: 'haiku-4.5',
    matchSubstrings: ['haiku-4-5', 'haiku-4.5'],
    inputPerMTok: 1.0,
    outputPerMTok: 5.0,
    effectiveFrom: null,
    effectiveUntil: null,
  },
  {
    id: 'haiku-3.5',
    matchSubstrings: ['3-5-haiku', 'haiku-3.5'],
    inputPerMTok: 0.8,
    outputPerMTok: 4.0,
    effectiveFrom: null,
    effectiveUntil: null,
  },
  {
    id: 'haiku-3',
    matchSubstrings: ['3-haiku', 'haiku-3'],
    inputPerMTok: 0.25,
    outputPerMTok: 1.25,
    effectiveFrom: null,
    effectiveUntil: null,
  },
];

/**
 * Fallback row used when no table entry matches `message.model` by substring.
 * Chosen as a conservative Sonnet 4-tier rate because unknown-model costs are
 * estimates. Callers must surface `estimated: true` when this row is used.
 */
export const FALLBACK_ROW = {
  id: 'fallback-sonnet',
  matchSubstrings: [],
  inputPerMTok: 3.0,
  outputPerMTok: 15.0,
  effectiveFrom: null,
  effectiveUntil: null,
};
