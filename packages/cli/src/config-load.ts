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
import { ConfigError, messageOf, type ParseOptions } from './config-values.js';
import { OperatorError } from './exit.js';
import { said } from './here.js';
import { parseConfig, parseOptionalSettings, type Config } from './config.js';
import { knownSettings, RENDER_SETTINGS } from './config-settings.js';
import { checkCarriers } from './config-placement.js';

/**
 * Read and validate a config file.
 *
 * A missing file is an operator error with the path in it, not a fallback to
 * defaults. Running with a config that was never read is how a CI job ends up
 * observing nothing and reporting success.
 */
export async function loadConfig(path: string): Promise<Config> {
  const { value, source, baseDir } = await readConfig(path);
  const config = parseConfig(value, { source, baseDir });
  const { cacheRoot, atRoot, suites } = rootAnswers(value as Record<string, unknown>, config.cacheRoot, { source, baseDir });
  // Inherited like the suites: what every suite rests on is declared once, at the
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

/**
 * The cache of a file that renders nothing, or `undefined` for a file that
 * renders, or tries to: {@link loadConfig} is the one that answers those.
 *
 * Only `doctor` asks. Every other command that reads a project needs the render
 * settings, and the ones that do not read no project file at all. What the file
 * does name is held to every rule it would meet beside the render settings: a typo
 * in `subjects` must not turn a file that renders into one that quietly does not.
 */
export async function loadRenderless(path: string): Promise<Pick<Config, 'cacheRoot'> | undefined> {
  const { value, source, baseDir } = await readConfig(path);
  const options = { source, baseDir };
  const settings = knownSettings(value, options);
  if (RENDER_SETTINGS.some((key) => key in settings)) return undefined;
  const { cacheRoot: named } = parseOptionalSettings(settings, options);
  return { cacheRoot: rootAnswers(settings, named, options).cacheRoot };
}

/**
 * What only the repository root answers, and the refusal of a file that answers
 * it anyway. Asked of every file, rendering or not: where a setting may stand does
 * not depend on what else the file names.
 */
function rootAnswers(
  settings: Record<string, unknown>,
  named: string | undefined,
  options: ParseOptions,
): { cacheRoot: string; atRoot: boolean; suites: ReturnType<typeof declaredSuites> } {
  const { source, baseDir } = options;
  // The test runners find the cache from the repository alone, so a
  // `cacheRoot` in any other file would be a second answer only this command
  // reads: the recording would go one place and the question another.
  const cacheRoot = cacheRootFor(baseDir);
  if (named !== undefined && named !== cacheRoot) {
    throw new ConfigError(
      source,
      'cacheRoot',
      'is read from the variance.config.json at the repository root, where every test runner ' +
        'looks for it; this file is not that one, so set it there',
    );
  }
  // The same rule for `suites`, `before`, `entrypoints`, `tiers` and `typescript`, compared by file rather than
  // by value: two files declaring the same suites today are two places to
  // change tomorrow.
  const atRoot = realpathSync(baseDir) === realpathSync(repositoryRoot(baseDir));
  if (settings['suites'] !== undefined && !atRoot) {
    throw new ConfigError(
      source,
      'suites',
      'is read from the variance.config.json at the repository root, where every test runner ' +
        'looks for it; this file is not that one, so declare them there',
    );
  }
  if (settings['before'] !== undefined && !atRoot) {
    throw new ConfigError(
      source,
      'before',
      'is read from the variance.config.json at the repository root, where `variance select` ' +
        'looks for it; this file is not that one, so declare it there',
    );
  }
  if (settings['entrypoints'] !== undefined && !atRoot) {
    throw new ConfigError(
      source,
      'entrypoints',
      'is read from the variance.config.json at the repository root, where `variance coverage --from` ' +
        'looks for it; this file is not that one, so declare them there',
    );
  }
  if (settings['tiers'] !== undefined && !atRoot) {
    throw new ConfigError(
      source,
      'tiers',
      'is read from the variance.config.json at the repository root, where `variance layers` and every ' +
        '`maxTier` rule look for it; this file is not that one, so declare them there',
    );
  }
  if (settings['typescript'] !== undefined && !atRoot) {
    throw new ConfigError(
      source,
      'typescript',
      'is read from the variance.config.json at the repository root, where every scan looks for it; ' +
        'this file is not that one, so declare it there',
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
  return { cacheRoot, atRoot, suites };
}

/** The file as JSON, with what a refusal of it says and what its paths resolve against. */
async function readConfig(path: string): Promise<{ value: unknown; source: string; baseDir: string }> {
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

  return { value, source, baseDir: dirname(resolve(path)) };
}

/** Whether a failed read is the file simply not being there. */
function missing(error: unknown): boolean {
  return (error as { code?: string } | undefined)?.code === 'ENOENT';
}
