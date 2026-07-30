import { writeConfig } from '../../budget/config.js';

/**
 * Write one or more budget cap values to config and exit.
 *
 * @param {{
 *   dailyCostCapUsd?: number,
 *   dailyTokenCap?: number,
 *   sessionCostCapUsd?: number,
 * }} updates
 */
export async function setBudgetCommand(updates) {
  const next = writeConfig(updates);
  console.log('cc-token-meter: budget config updated.');
  console.log(JSON.stringify(next, null, 2));
}
