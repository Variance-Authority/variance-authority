/**
 * Where a Jest run drops the test files a selection may skip: its `filter`.
 *
 * Jest calls a filter with every test file one project found, before it shards,
 * sorts or lists them, in the process that loaded the configuration. A filter
 * is named by path, so the seam names [`jest-filter.cts`](./jest-filter.cts)
 * and leaves the function it calls on `globalThis`; the selection the
 * configuration was handed is read the first time Jest asks, and once for every
 * project after.
 *
 * `filter` is a global setting, not a project one, so a project's own filter is
 * chained rather than replaced: it runs first, and the selection drops from
 * what it kept. Jest 29 asked a filter for `{ test }` objects where Jest 30
 * asks for paths, so either shape is read from it, and this one answers Jest
 * 30's. Jest 29 reads that answer as no files and passes, so a configuration
 * that selects under a Jest older than 30 throws while it loads, naming the
 * version it found.
 *
 * `--filter` on the command line replaces the configuration's filter and
 * `--skipFilter` turns filters off. Either turns the selection off, and the
 * seam says so.
 */

// compass: variance-authority.reach

import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectPath } from './instrumented-modules.js';
import { selectedLines, type SuiteSelection } from './suite-selection.js';

/** The filter module a selecting configuration names, by absolute path. */
export const SELECTION_FILTER = fileURLToPath(new URL('./jest-filter.cjs', import.meta.url));

/** Where the configuration leaves its filter; mirrors `HANDED` in `jest-filter.cts`. */
const HANDED = Symbol.for('variance-authority:jest-selection');

type Filtered = { readonly filtered: ReadonlyArray<string | { readonly test: string }> };
type OwnFilter = ((testPaths: string[]) => Promise<Filtered> | Filtered) & { setup?: () => unknown };

export interface SelectingFilterOptions {
  /** The checkout the selection names its files from. */
  readonly root: string;
  /** The configuration's `rootDir`, which a project filter's path is relative to. */
  readonly rootDir: string;
  readonly selection: () => Promise<SuiteSelection>;
  /** The command line, read for `--watch`, `--filter` and `--skipFilter` only. */
  readonly argv?: readonly string[];
  readonly say?: (line: string) => void;
}

/**
 * The `filter` a configuration takes to drop what the selection skips, or
 * nothing when the run should not select: in watch mode, under a filter named
 * on the command line, and when the configuration already selects.
 */
export function selectingFilter(
  config: { readonly [key: string]: unknown },
  options: SelectingFilterOptions,
): { filter?: string } {
  const { argv = process.argv, say = (line: string) => process.stderr.write(`${line}\n`) } = options;
  if (config.filter === SELECTION_FILTER) return {};
  // `--watch=false` is the flag written off, as Jest reads it.
  const flag = (name: string) => argv.some((arg) => arg === name || (arg.startsWith(`${name}=`) && arg !== `${name}=false`));
  if (config.watch === true || config.watchAll === true || flag('--watch') || flag('--watchAll')) {
    say('variance-authority: watch mode does not select');
    return {};
  }
  if (flag('--filter')) {
    say('variance-authority: --filter on the command line replaces the selection filter, so nothing is selected');
    return {};
  }
  if (flag('--skipFilter')) {
    say('variance-authority: --skipFilter turns the selection filter off, so nothing is selected');
    return {};
  }
  supported(options.rootDir);
  const own = typeof config.filter === 'string' ? ownFilter(config.filter, options.rootDir) : undefined;
  let read: Promise<SuiteSelection> | undefined;
  let told = false;
  const filter = async (testPaths: readonly string[]): Promise<{ filtered: string[] }> => {
    const found = own === undefined ? [...testPaths] : await own(testPaths);
    const selection = await (read ??= options.selection());
    const lines = selectedLines(selection, found.map((path) => projectPath(options.root, path)));
    for (const line of told ? lines.slice(0, 1) : lines) say(line);
    told = true;
    return { filtered: found.filter((path) => !selection.skip.has(projectPath(options.root, path))) };
  };
  (globalThis as { [HANDED]?: { filter: typeof filter } })[HANDED] = { filter };
  return { filter: SELECTION_FILTER };
}

/** The oldest Jest that reads the paths a filter answers. */
const SUPPORTED = 30;

/** Refuses a Jest the filter's answer would be read as no files by, or none at all, by name. */
function supported(rootDir: string): void {
  const from = createRequire(resolve(rootDir, 'package.json'));
  let version: string;
  try {
    version = (from(from.resolve('jest/package.json')) as { version: string }).version;
  } catch {
    throw new Error(`variance-authority: selection needs Jest ${SUPPORTED} or newer, and ${rootDir} resolves no \`jest\``);
  }
  if (Number.parseInt(version, 10) < SUPPORTED) {
    throw new Error(
      `variance-authority: selection needs Jest ${SUPPORTED} or newer, and ${rootDir} resolves Jest ${version}, ` +
        'which reads the files a filter keeps as none',
    );
  }
}

/** The project's own filter, loaded as Jest loads one, answering paths whichever shape it returns. */
function ownFilter(spelled: string, rootDir: string): (testPaths: readonly string[]) => Promise<string[]> {
  const from = createRequire(resolve(rootDir, 'package.json'));
  const path = spelled.startsWith('<rootDir>') ? resolve(rootDir, spelled.replace(/^<rootDir>\/?/, '')) : spelled;
  let loaded: Promise<OwnFilter> | undefined;
  return async (testPaths) => {
    const filter = await (loaded ??= (async () => {
      const module = from(from.resolve(path, { paths: [rootDir] })) as OwnFilter;
      await module.setup?.();
      return module;
    })());
    const { filtered } = await filter([...testPaths]);
    return filtered.map((entry) => (typeof entry === 'string' ? entry : entry.test));
  };
}
