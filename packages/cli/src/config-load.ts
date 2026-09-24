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
import { cacheRootFor } from '@variance-authority/sense/test-selection';
import { ConfigError, messageOf } from './config-values.js';
import { OperatorError } from './exit.js';
import { said } from './here.js';
import { parseConfig, type Config } from './config.js';

/**
 * Read and validate a config file.
 *
 * A missing file is an operator error with the path in it, not a fallback to
 * defaults. Running with a config that was never read is how a CI job ends up
 * observing nothing and reporting success.
 */
export async function loadConfig(path: string): Promise<Config> {
  // The path is held absolute and said from here: one spelling can only ever mean
  // one file, and the other is the one the reader typed and can type again.
  const source = said(path);
  let text: string;

  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    // A file that is not there is said once. The system's own message repeats the
    // path in full, which on an installed consumer is a second line about
    // somebody's home directory and nothing about what to do.
    const because = missing(error) ? 'there is no file there' : messageOf(error);
    throw new OperatorError(
      `cannot read the config file ${source}: ${because}. ` +
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

  const baseDir = dirname(resolve(path));
  const config = parseConfig(value, { source, baseDir });
  // The test runners find the cache from the repository alone, so a
  // `cacheRoot` in any other file would be a second answer only this command
  // reads: the recording would go one place and the question another.
  const cacheRoot = cacheRootFor(baseDir);
  if (config.cacheRoot !== undefined && config.cacheRoot !== cacheRoot) {
    throw new ConfigError(
      source,
      'cacheRoot',
      'is read from the variance.config.json at the repository root, where every test runner ' +
        'looks for it; this file is not that one, so set it there',
    );
  }
  return { ...config, cacheRoot };
}

/** Whether a failed read is the file simply not being there. */
function missing(error: unknown): boolean {
  return (error as { code?: string } | undefined)?.code === 'ENOENT';
}
