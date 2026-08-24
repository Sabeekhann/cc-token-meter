import os from 'node:os';
import path from 'node:path';

export const HOME_OVERRIDE_ENV = 'CC_TOKEN_METER_HOME';

/**
 * Resolve the home used by cc-token-meter. The explicit override exists for
 * isolated lifecycle tests and portable installations; normal users continue
 * to use the operating-system home directory.
 */
export function resolveHomeDirectory(env = process.env) {
  const override = env && env[HOME_OVERRIDE_ENV];
  return typeof override === 'string' && override.trim().length > 0
    ? path.resolve(override)
    : os.homedir();
}

export function resolveProjectsDirectory(home = resolveHomeDirectory()) {
  return path.join(home, '.claude', 'projects');
}

export function resolveStateDirectory(home = resolveHomeDirectory()) {
  return path.join(home, '.claude-token-meter');
}
