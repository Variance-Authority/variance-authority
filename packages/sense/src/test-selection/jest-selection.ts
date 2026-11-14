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
 * `--filter` on the command line replaces the configuration's filter and
 * `--skipFilter` turns filters off. Either turns the selection off, and the
 * seam says so. A selection that keeps no file passes, and a run that found none
 * to keep fails: {@link refuseUnfound} tells them apart.
 */

// compass: variance-authority.reach

import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CUT_VARIABLE, cutOf, writeCut } from './case-cut.js';
import { projectPath } from './instrumented-modules.js';
import { kept, placed, selectedLines, type SuiteSelection } from './suite-selection.js';

/** The filter module a selecting configuration names, by absolute path. */
export const SELECTION_FILTER = fileURLToPath(new URL('./jest-filter.cjs', import.meta.url));

/** Where the configuration leaves its filter; mirrors `HANDED` in `jest-filter.cts`. */
const HANDED = Symbol.for('variance-authority:jest-selection');

/** What a selecting configuration leaves for the filter module and the sequencer. */
interface Handed {
  readonly filter: (testPaths: readonly string[]) => Promise<{ filtered: string[] }>;
  /** Whether no project found a file and nothing the run was told lets that pass. */
  readonly unfound: () => boolean;
  /** What every project's filter left a shard to place (`placed`), by absolute path; `undefined` when it places what it runs. */
  readonly placing: () => readonly string[] | undefined;
}

type Filtered = { readonly filtered: ReadonlyArray<string | { readonly test: string }> };
type OwnFilter = ((testPaths: string[]) => Promise<Filtered> | Filtered) & { setup?: () => unknown };

export interface SelectingFilterOptions {
  /** The checkout the selection names its files from. */
  readonly root: string;
  /** The configuration's `rootDir`, which a project filter's path is relative to. */
  readonly rootDir: string;
  readonly selection: () => Promise<SuiteSelection>;
  /**
   * Where to write the cases the selection skips in the files it keeps, for
   * the workers; absent, every kept file runs whole. See `case-cut.ts`.
   */
  readonly cutFile?: string;
  /** The command line, read for `--watch`, `--filter` and `--skipFilter` only. */
  readonly argv?: readonly string[];
  readonly say?: (line: string) => void;
}

/**
 * The `filter` a configuration takes to drop what the selection skips, or
 * nothing when the run should not select: in watch mode, under a filter named
 * on the command line, and when the configuration already selects. Beside it,
 * `passWithNoTests`, whatever the configuration says, so a selection that keeps
 * no file passes; {@link refuseUnfound} fails the run that found none. Without
 * the sequencer that calls it, under `--testSequencer` on the command line, the
 * flag is the configuration's alone and Jest fails both, a `--shard` included:
 * this answer outranks `placingSequencer`'s.
 */
export function selectingFilter(
  config: { readonly [key: string]: unknown },
  options: SelectingFilterOptions,
): { filter?: string; passWithNoTests?: boolean } {
  const { argv = process.argv, say = (line: string) => process.stderr.write(`${line}\n`) } = options;
  if (config.filter === SELECTION_FILTER) return {};
  // `--watch=false` is the flag written off, as Jest reads it.
  const flag = (...names: string[]) => argv.some((arg) => names.some((name) => arg === name || (arg.startsWith(`${name}=`) && arg !== `${name}=false`)));
  if (config.watch === true || config.watchAll === true || flag('--watch', '--watchAll', '--watch-all')) {
    say('variance-authority: watch mode does not select');
    return {};
  }
  if (flag('--filter')) {
    say('variance-authority: --filter on the command line replaces the selection filter, so nothing is selected');
    return {};
  }
  if (flag('--skipFilter', '--skip-filter')) {
    say('variance-authority: --skipFilter turns the selection filter off, so nothing is selected');
    return {};
  }
  supported(options.rootDir);
  const replaced = flag('--testSequencer', '--test-sequencer');
  if (replaced) say('variance-authority: --testSequencer replaces the sequencer that tells an empty selection from a run that found no file, so Jest fails both');
  const passes = config.passWithNoTests === true || flag('--passWithNoTests', '--pass-with-no-tests');
  const own = typeof config.filter === 'string' ? ownFilter(config.filter, options.rootDir) : undefined;
  let read: Promise<SuiteSelection> | undefined;
  let told = false;
  let seen = 0;
  const cut = new Map<string, readonly string[]>();
  let placing: string[] | undefined;
  const filter = async (testPaths: readonly string[]): Promise<{ filtered: string[] }> => {
    const found = own === undefined ? [...testPaths] : await own(testPaths);
    seen += found.length;
    const selection = await (read ??= options.selection());
    const lines = selectedLines(selection, found.map((path) => projectPath(options.root, path)));
    for (const line of told ? lines.slice(0, 1) : lines) say(line);
    told = true;
    const filtered = [...kept(selection, found, (path) => projectPath(options.root, path))];
    if (selection.placing !== undefined) (placing ??= []).push(...placed(selection, found, (path) => projectPath(options.root, path)));
    // Called once per project: what each keeps is added to the one cut, which
    // is on disk, and named in the environment, before any worker forks.
    const cases = options.cutFile === undefined ? new Map() : cutOf(selection, filtered, options.root);
    if (cases.size > 0) {
      for (const [file, names] of cases) cut.set(file, names);
      writeCut(options.cutFile!, cut);
      process.env[CUT_VARIABLE] = options.cutFile;
    }
    return { filtered };
  };
  (globalThis as { [HANDED]?: Handed })[HANDED] = { filter, unfound: () => seen === 0 && !passes, placing: () => placing };
  return { filter: SELECTION_FILTER, passWithNoTests: !replaced || config.passWithNoTests === true };
}

/**
 * The test files a Jest shard places, by absolute path, when the selection is
 * one wave of a shard: what every project's filter found that some wave runs.
 * `undefined` when the run did not select, or the shard places what it runs.
 */
export function placingPaths(): readonly string[] | undefined {
  return (globalThis as { [HANDED]?: Handed })[HANDED]?.placing();
}

/** What Jest's frozen global configuration says about a run with no file to run. */
export interface RunWithNoFile {
  /** Under either, Jest answers before it asks whether the run has tests. */
  readonly listTests?: boolean;
  readonly collectTests?: boolean;
  /** Either passes a run with no tests under Jest; `--changedSince` sets the first. */
  readonly onlyChanged?: boolean;
  readonly lastCommit?: boolean;
}

/**
 * Throws, as Jest's own check would exit 1, when a selected run has no file to
 * run because no project found one: a `testMatch`, a working directory or a
 * project that points at nothing. `passWithNoTests` is set before the filter
 * runs, when neither run can be told from the other, so the filter counts what
 * Jest and the project's own filter left it, and the sequencer's `sort`, the one call after every filter and
 * before Jest decides the run has no tests, asks here. The count is the whole
 * run's: a project that found nothing beside one that did is no failure under
 * Jest either. A reporter would come after Jest printed that it exits 0, and
 * `--reporters` on the command line would drop it.
 */
export function refuseUnfound(tests: readonly unknown[], run: RunWithNoFile): void {
  const handed = (globalThis as { [HANDED]?: Handed })[HANDED];
  if (tests.length > 0 || handed?.unfound() !== true) return;
  if (run.listTests === true || run.collectTests === true || run.onlyChanged === true || run.lastCommit === true) return;
  throw new Error(
    'variance-authority: Jest left no test file to select from, so the run fails: ' +
      'check testMatch, the working directory, the project configuration and its filter',
  );
}

/** The oldest Jest that reads the paths a filter answers: Jest 29 reads them as no files, and passes. */
const SUPPORTED = 30;

/** Refuses a Jest the filter's answer would be read as no files by, or none at all, by name. */
function supported(rootDir: string): void {
  // The project's Jest, not ours: resolved and read from its root.
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

/**
 * The project's own filter, loaded as Jest loads one. `filter` is a global
 * setting, so it is chained rather than replaced: it runs first, and the
 * selection drops from what it kept. Jest 29 asked for `{ test }` objects where
 * Jest 30 asks for paths, so either shape is read.
 */
function ownFilter(spelled: string, rootDir: string): (testPaths: readonly string[]) => Promise<string[]> {
  // The project's own filter, at the path its configuration names, from its root.
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
