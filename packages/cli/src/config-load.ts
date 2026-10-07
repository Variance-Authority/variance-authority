/**
 * The half of config handling that touches a disk.
 *
 * Split from [`config.ts`](./config.ts) so the rules stay reachable with nothing
 * installed and nothing mounted: `parseConfig` is handed an object, and every
 * rule it applies is testable that way. What is left here is the read and the
 * parse, which are the only two steps that can fail before a rule ever runs.
 */

import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { beforeOf, cacheRootFor, declaredSuites, repositoryRoot, rootConfig } from '@variance-authority/sense/test-selection';
import { ConfigError, messageOf } from './config-values.js';
import { OperatorError } from './exit.js';
import { said } from './here.js';
import { parseConfig, type Config } from './config.js';
import { checkCarriers } from './config-placement.js';

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
    const because = missing(error) ? 'no such file' : messageOf(error);
    throw new OperatorError(`cannot read the config file ${source}: ${because}`, { cause: error });
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
  // The same rule for `suites`, `before`, `entrypoints` and `tiers`, compared by file rather than
  // by value: two files declaring the same suites today are two places to
  // change tomorrow.
  const atRoot = realpathSync(baseDir) === realpathSync(repositoryRoot(baseDir));
  if (config.suites !== undefined && !atRoot) {
    throw new ConfigError(
      source,
      'suites',
      'is read from the variance.config.json at the repository root, where every test runner ' +
        'looks for it; this file is not that one, so declare them there',
    );
  }
  if (config.before !== undefined && !atRoot) {
    throw new ConfigError(
      source,
      'before',
      'is read from the variance.config.json at the repository root, where `variance select` ' +
        'looks for it; this file is not that one, so declare it there',
    );
  }
  if ((value as Record<string, unknown>)['entrypoints'] !== undefined && !atRoot) {
    throw new ConfigError(
      source,
      'entrypoints',
      'is read from the variance.config.json at the repository root, where `variance coverage --from` ' +
        'looks for it; this file is not that one, so declare them there',
    );
  }
  if ((value as Record<string, unknown>)['tiers'] !== undefined && !atRoot) {
    throw new ConfigError(
      source,
      'tiers',
      'is read from the variance.config.json at the repository root, where `variance layers` and every ' +
        '`maxTier` rule look for it; this file is not that one, so declare them there',
    );
  }
  const suites = declaredSuites(baseDir);
  // Again once the root's suites are in, against the file they came from: a
  // suite carries to the root's `share`, which `share --suite` and `select` read
  // back, so a member file is held to its root's section and never its own.
  const root = rootConfig(baseDir);
  if (suites !== undefined && root !== undefined) {
    checkCarriers(
      { share: root.value['share'], reportCarry: undefined, suites },
      { source: said(root.file), baseDir: dirname(root.file) },
    );
  }
  // Inherited the same way: what every suite rests on is declared once, at the
  // root, and a member config runs those suites. `beforeOf` answers empty only
  // for a root that declares none, since a declared list is never empty.
  const before = atRoot ? config.before : beforeOf(baseDir, undefined);
  return {
    ...config,
    cacheRoot,
    ...(suites === undefined ? {} : { suites }),
    ...(before === undefined || before.length === 0 ? {} : { before }),
  };
}

/** Whether a failed read is the file simply not being there. */
function missing(error: unknown): boolean {
  return (error as { code?: string } | undefined)?.code === 'ENOENT';
}
