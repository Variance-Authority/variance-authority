/**
 * The half of config handling that touches a disk.
 *
 * Split from [`config.ts`](./config.ts) so the rules stay reachable with nothing
 * installed and nothing mounted: `parseConfig` is handed an object, and every
 * rule it applies is testable that way. What is left here is the read and the
 * parse, which are the only two steps that can fail before a rule ever runs.
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { ConfigError, messageOf } from './config-values.js';
import { OperatorError } from './exit.js';
import { parseConfig, type Config } from './config.js';

/**
 * Read and validate a config file.
 *
 * A missing file is an operator error with the path in it, not a fallback to
 * defaults. Running with a config that was never read is how a CI job ends up
 * observing nothing and reporting success.
 */
export async function loadConfig(path: string): Promise<Config> {
  const source = path;
  let text: string;

  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    throw new OperatorError(
      `cannot read the config file ${path}: ${messageOf(error)}. ` +
        'Nothing about a run is inferred, so there is no default to fall back to.',
      { cause: error },
    );
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new ConfigError(source, '(file)', `is not valid JSON: ${messageOf(error)}`);
  }

  return parseConfig(value, { source, baseDir: dirname(resolve(path)) });
}
