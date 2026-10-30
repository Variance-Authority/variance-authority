/**
 * Test selection for Rstest: the same probes, journal, and snapshot as the
 * Vitest seam, arranged for a runner that bundles the suite before it runs it.
 *
 * Rstest builds with Rspack, so the two halves are an
 * [`enforce: 'pre'` loader](./rstest-loader.ts) for the test files it cuts, an
 * [`enforce: 'post'` loader](./rstest-after-loader.ts) for every other module,
 * and a reporter. All live in the process Rstest was started in — the loaders
 * run in the main process, not in a worker — so they are joined the way the Vitest seam joins its plugin to
 * its reporter, through the run registry in
 * [`selection-run.ts`](./selection-run.ts). A loader cannot be handed the run
 * object, only options the bundler may carry as data, so it is given the one
 * string that names a run: the snapshot it will write.
 *
 * ```ts
 * // rstest.config.ts
 * import { defineConfig } from '@rstest/core';
 * import { withTestSelection } from '@variance-authority/sense/rstest';
 *
 * export default defineConfig(withTestSelection({ globals: true }));
 * ```
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { InstrumentMode } from '../instrument/index.js';
import { probesRegions } from '../instrument/identity.js';
import { defaultInclude, type ProbePlacement } from './instrumented-modules.js';
import { AFTER_LOADER, SELECTION_LOADER, unprobedFiles } from './rstest-loaders.js';
import { carriedJournal, statusesComplete } from './finished-files.js';
import { pageTaping, writeCarriedStories } from './carried-stories.js';
import { reportedDuration } from './reported-time.js';
import { foldRun } from './selection-fold.js';
import { removeSeamModules, reopenRun, runFor, seamModuleId, writeSeamModule, type SelectionRun } from './selection-run.js';
import { browserSetupSource, setupSource } from './worker-source.js';
import { attendingSource, caseGlobalsSource } from './rstest-case-source.js';
import { recordFileFor } from './record-location.js';
import { testFilesAt } from './test-files.js';
import { repositoryRoot } from './repository-root.js';
import { askedForStories } from '../story/directory.js';
import { finishedCase } from './case-durations.js';

export interface RstestTestSelectionOptions {
  /**
   * A directory inside the repository; defaults to the Rstest config root, then
   * the current directory. Names are relative to the checkout it sits in, never
   * to it, and relative option paths resolve against it.
   */
  readonly root?: string;
  /** Persisted coverage index. Defaults to the repository's cache. */
  readonly coverageFile?: string;
  /**
   * The suite this run is, as the root `variance.config.json` declares it under
   * `suites`. Required once any suite is declared, and refused beside
   * `coverageFile`.
   */
  readonly suite?: string;
  /** Decide which bundled modules are product source. */
  readonly include?: (file: string) => boolean;
  /**
   * Decide which bundled modules are product source no probe may sit in: a
   * module whose functions cross into a page as text, where the first probe
   * would throw. It wins over `include`. Each is marked as loaded at its end
   * instead, and an edit to it selects every test that loaded it.
   */
  readonly unprobed?: (file: string) => boolean;
  /**
   * Additional files whose contents are preconditions of every test observation.
   *
   * The configured setup files are declared already; the config file is not,
   * because Rstest hands neither a loader nor a reporter the path it loaded —
   * it keeps that on an internal context, and a reporter is handed results,
   * never configuration. Name the config file here, and any local module it
   * imports.
   */
  readonly preconditions?: readonly string[];
  /**
   * `presence`, the default, probes every arrival region; `entries` probes
   * modules and functions only, so a suite reads it no finer than
   * `function-use`. Both record which functions ran before the file's first
   * test. `loads` probes nothing: each module runs with one line after its own
   * text, the record says which files each test loaded, and a change to a file
   * selects every test that loaded it. Under it `cadence` is off, whatever it
   * says.
   */
  readonly mode?: InstrumentMode;
  /**
   * Where the probes go. `after-transforms`, the default, places them after
   * the project's loaders, through the map Rspack hands on, so a compiler
   * that reads syntax reads none. `before-transforms` places them in the file
   * as read, ahead of every loader, one parse and no map: for a suite whose
   * loaders only strip types or JSX.
   */
  readonly placement?: ProbePlacement;
  /**
   * Follow each case through the async context, and name the cases whose work
   * outlived them.
   *
   * Without it, the case recording assumes what a suite almost always is: one case at a
   * time. The case running now is a variable, the probe reads a closure slot
   * for it, and per-case recording costs what the per-file recording costs. A
   * second case opening while one is still open records that file whole rather
   * than guessing, because the guess charges one case's crossings to another and a
   * case credited with less than it reached is a case a change can skip.
   *
   * With it, each case gets an async context instead, which follows its
   * continuations wherever they settle and gives concurrent cases a bucket
   * each. Reading which continuation is running costs 4.7 nanoseconds a
   * crossing over the variable, which a microbenchmark separates and a real
   * suite does not: over zod's 5,656 cases the crossing count predicts 0.2%,
   * and the runs do not resolve it. What you buy for it is the list of cases
   * that made a crossing after they had settled, printed when the file ends:
   * the tests
   * that are still running when the next one starts.
   *
   * Turn it on to find those, and to record a suite that is deliberately
   * concurrent. Leave it off the rest of the time.
   */
  readonly continuations?: boolean;
  /**
   * Whether each statement of a test or a hook is cut, so the record says which
   * line of the test first reached each region its case entered. On by default.
   * The cut is one call per statement the test runs, and it reaches the record
   * only as a line per case; turn it off to record a suite exactly as it ran
   * before cuts existed.
   */
  readonly cadence?: boolean;
}

/** What one test file's run left behind, as Rstest's `onTestRunEnd` reports it. */
export interface RstestFileResult {
  readonly testPath: string;
  readonly status: string;
  /** Each case: its names are what `currentTestName` joins with ` > `. */
  readonly results?: ReadonlyArray<{
    readonly status: string;
    readonly name?: string;
    readonly parentNames?: readonly string[];
    readonly duration?: number;
    readonly testId?: string;
    /** What the case's context put on its `meta`, carried from wherever it ran. */
    readonly meta?: object;
  }>;
  /** What the file's own `afterAll` put on its context, carried from wherever it ran. */
  readonly meta?: object;
  /** The name of the project that ran it. */
  readonly project?: string;
  /** The milliseconds Rstest measured for the file, when it did. */
  readonly duration?: number;
}

/** What `onTestRunEnd` is handed: `rerunTestPaths` is there only when Rstest watches. */
interface RstestRunEnd {
  readonly results: readonly RstestFileResult[];
  readonly rerunTestPaths?: readonly string[];
}

/**
 * The files the cycle that just ended ran. A watching Rstest hands every file
 * of the session in `results`, and the ones this cycle ran in `rerunTestPaths`:
 * a file that did not run this cycle wrote no journal to fold.
 */
function cycleResults(run: SelectionRun, payload: RstestRunEnd): readonly RstestFileResult[] {
  if (payload.rerunTestPaths === undefined) return payload.results;
  run.watching = true;
  const ran = new Set(payload.rerunTestPaths);
  return payload.results.filter((file) => ran.has(file.testPath));
}

/** The subset of an Rstest configuration this seam reads and rewrites. */
export interface RstestConfig {
  readonly root?: string;
  readonly name?: string;
  readonly globals?: boolean;
  readonly setupFiles?: string | readonly string[];
  readonly globalSetup?: string | readonly string[];
  readonly reporters?: unknown;
  readonly projects?: unknown;
  readonly tools?: { readonly rspack?: unknown; readonly [key: string]: unknown };
  readonly [key: string]: unknown;
}

/** A project's own preconditions, under the name Rstest reports it by. */
function projectKey(name: string): string {
  return `project:${name}`;
}

/**
 * The refusal of a run whose first loader passed modules on that the probes
 * loader never reached: {@link unprobedFiles}.
 */
function unprobedAtEnd(run: SelectionRun): Promise<never> | undefined {
  if (run.awaiting.size === 0) return undefined;
  const error = unprobedFiles(run.root, run.awaiting);
  run.awaiting.clear();
  return Promise.reject(error);
}

/**
 * Rstest's API, which is an injected object rather than a resolvable module.
 *
 * Rspack is configured with `'@rstest/core': 'global @rstest/core'`, so an
 * import of it compiles to a read of that property of the realm, and the
 * runner assigns the API there before a setup file runs. A `resolve.alias` on
 * the specifier never fires, and this is the name that does.
 */
const RSTEST_API = '@rstest/core';

/**
 * Add source instrumentation, test-file attribution, and coverage persistence to
 * an ordinary Rstest configuration.
 *
 * Everything the configuration already had stays: its `setupFiles` keep their
 * order and gain one file at the start, its `reporters` gain one at the end,
 * and its `tools.rspack` gains a rule rather than being replaced.
 */
export function withTestSelection(
  config: RstestConfig = {},
  options: RstestTestSelectionOptions = {},
): RstestConfig {
  const configRoot = resolve(options.root ?? config.root ?? process.cwd());
  const root = repositoryRoot(configRoot);
  const coverageFile = recordFileFor(root, configRoot, options);
  const mode = options.mode ?? 'presence';
  const run = runFor(coverageFile, root, mode);

  const setupId = seamModuleId(configRoot, run, 'setup');
  run.shims.add(setupId);

  // A `globalSetup` file runs before any test environment exists, so the setup
  // shim that installs the probe log has never run where one evaluates:
  // instrumented, such a file throws at its first probe and takes the whole
  // suite with it.
  const globalSetup = new Set(array(config.globalSetup).map((file) => resolve(configRoot, file)));
  const chosen = options.include ?? defaultInclude;
  run.include = (file: string): boolean => !globalSetup.has(file) && chosen(file);
  const marked = options.unprobed;
  run.unprobed = marked === undefined ? undefined : (file: string): boolean => !globalSetup.has(file) && marked(file);
  run.placement = options.placement ?? 'after-transforms';
  // Under `loads` no region is probed for a line of a test to have reached first.
  run.cadence = options.cadence === false || !probesRegions(mode)
    ? undefined
    : testFilesAt(configRoot, undefined, config['include'] as readonly string[] | undefined);

  const setupFiles = array(config.setupFiles);
  // A setup entry may be a package — `dotenv/config` — rather than a file of
  // the project's; a package is no precondition a diff can carry, and read as a
  // path it is a missing file that fails the reporter and loses the snapshot.
  //
  // A project's setup files govern that project's tests, the way
  // `governing-config.ts` says for Vitest. Rstest names the project a file ran
  // under, and a project's name is the one its configuration gives, so a named
  // project keeps its own; one Rstest names by default is named after this
  // runs, and its files govern every test, as they did before anybody asked.
  const own = typeof config.name === 'string' && config.projects === undefined
    ? run.configs.get(projectKey(config.name)) ?? new Set<string>()
    : run.preconditions;
  if (own !== run.preconditions) run.configs.set(projectKey(config.name as string), own);
  for (const file of [
    ...setupFiles.filter((file) => existsSync(resolve(configRoot, file))),
    ...(options.preconditions ?? []),
  ]) own.add(resolve(configRoot, file));
  // The configuration that lists the projects is what every test rests on.
  if (config.projects !== undefined) run.runConfig = '';

  const settle = foldRun(run, { coverageFile, shims: [setupId] });
  const story = askedForStories(coverageFile);
  let ended: number | undefined;
  const reporter = {
    // A watching Rstest starts every cycle here, after the last cycle's end.
    // Rstest builds the cycle's bundle, reading its files, before it announces
    // the start: the first cycle began when the run was made, and a rerun when
    // the last cycle ended.
    // FIXME: so a watching rerun counts the save that started it as a write
    // while it ran, and records the files it saved incomplete.
    onTestRunStart: () => reopenRun(run, ended ?? run.startedAt),
    onTestRunEnd: async (payload: RstestRunEnd) => {
      ended = Date.now();
      const named = [...nameFiltersOf(run)].some((filter) => ![undefined, ''].includes(filter() as string | undefined));
      const files = cycleResults(run, payload);
      await writeCarriedStories(story, files.flatMap(caseEnds));
      return unprobedAtEnd(run) ?? settle(files.map((file) => ({
        filepath: file.testPath,
        complete: statusesComplete(file.status, (file.results ?? []).map((test) => test.status), named),
        ...reportedDuration(file.duration),
        ...(file.results === undefined ? {} : {
          cases: file.results.map((test) => finishedCase(caseNameOf(test), undefined, test.duration)),
        }),
        ...carriedJournal(file.testPath, file.meta),
        ...(file.project === undefined ? {} : { configs: [projectKey(file.project)] }),
      })));
    },
    // A watching run kept its shim for the cycles after the first.
    onExit: () => removeSeamModules(run, [setupId]),
  };
  const reporters = config.reporters === undefined ? ['default'] : array(config.reporters);

  // A configuration that names projects describes the run rather than a suite:
  // nothing is bundled under it, and it is the only place a reporter is read
  // from. Adding the loader and the setup file here would put them on a config
  // that builds no test file.
  if (config.projects !== undefined) {
    return { ...config, reporters: [...reporters, reporter] };
  }

  // Both spellings of the same registrar, because a project may use either and
  // the seam is not told which. `globals: true` puts `it` and `test` on the
  // realm; a test file that imports them instead reads them off
  // `globalThis['@rstest/core']`, which is where Rstest assigns its API and
  // what Rspack compiles the import of that external to. Wrapping both reaches
  // a mixed suite, and wrapping an absent one is skipped.
  const scope = caseGlobalsSource(`globalThis, globalThis[${JSON.stringify(RSTEST_API)}]`) +
    attendingSource(`globalThis[${JSON.stringify(RSTEST_API)}]`);
  return {
    ...config,
    // First, so a setup file of the project's that loads an instrumented
    // module finds the probe log its header resolves.
    setupFiles: [
      writeSeamModule(
        run,
        setupId,
        setupSource(run.runDirectory, run.caseDirectory, {
          runner: RSTEST_API,
          root,
          continuations: options.continuations === true,
          scope,
          story,
          cases: probesRegions(mode),
        }),
      ),
      ...setupFiles,
    ],
    plugins: [...array(config.plugins), pagePlugin(setupId, run, mode, story !== undefined)],
    reporters: [...reporters, reporter],
    tools: {
      ...config.tools,
      // After whatever the project configured, as a function, so the rules
      // are placed among every rule Rsbuild and the project wrote. Loaders of
      // one phase run right to left: the pre rule goes last, ahead of every
      // other pre loader, and the post rule first, after every other post
      // loader.
      rspack: [
        ...array(config.tools?.rspack),
        (rspack: { module?: { rules?: unknown[] } }) => {
          const rules = rspack.module?.rules ?? [];
          rspack.module = {
            ...rspack.module,
            rules: [
              {
                test: /\.[cm]?[jt]sx?$/,
                // After SWC and the project's own loaders, so a compiler that
                // reads syntax never reads a probe, and the probes go where
                // their map says the file went.
                enforce: 'post',
                use: [{ loader: AFTER_LOADER, options: { coverageFile } }],
              },
              ...rules,
              {
                test: /\.[cm]?[jt]sx?$/,
                // Before them, so a test file's cut lands on the file as it is
                // on disk, and a file that names its own map is probed on it.
                enforce: 'pre',
                use: [{ loader: SELECTION_LOADER, options: { coverageFile } }],
              },
            ],
          };
        },
      ],
    },
  };
}

/** The part of Rsbuild's plugin API this seam reads. */
interface RsbuildPluginApi {
  readonly useExposed: (id: string) => {
    readonly getRstestConfig: () => {
      readonly browser?: { readonly enabled?: boolean };
      readonly testNamePattern?: string | RegExp;
    };
  } | undefined;
}

const nameFilters = new WeakMap<SelectionRun, Set<() => unknown>>();

/**
 * The name filter each project of a run runs under, read when a cycle ends: a
 * watch session sets and clears it between cycles. Every test a filter left out
 * reads as skipped, so under one no skip in the run is the file's own.
 */
function nameFiltersOf(run: SelectionRun): Set<() => unknown> {
  let filters = nameFilters.get(run);
  if (filters === undefined) nameFilters.set(run, (filters = new Set()));
  return filters;
}

/**
 * The setup module for a test file that runs in a page, swapped in where the
 * run says it does.
 *
 * Where a file runs is the runner's to say, and `--browser.enabled` says it
 * after the configuration was written. Rstest hands its Rsbuild plugins the
 * configuration with the command line merged in, so it is read there, and so is
 * `-t`, which skips every test it does not name.
 */
function pagePlugin(setupId: string, run: SelectionRun, mode: InstrumentMode, taping: boolean) {
  return {
    name: 'variance-authority:test-selection',
    async setup(api: RsbuildPluginApi): Promise<void> {
      const exposed = api.useExposed('rstest');
      // `-t` is merged in here too, and watch mode's `t` sets it between cycles.
      if (exposed !== undefined) nameFiltersOf(run).add(() => exposed.getRstestConfig().testNamePattern);
      if (exposed?.getRstestConfig().browser?.enabled !== true) return;
      writeSeamModule(run, setupId, browserSetupSource(mode, RSTEST_API, taping ? await pageTaping() : undefined));
      // A test line reaches the record through a case's story alone in a page:
      // a page that does not tape cuts nothing.
      if (!taping) run.cadence = undefined;
      // TODO: record cases in a page in the case index, as each case's story is.
      if (run.cases) {
        run.cases = false;
        console.warn(
          'variance-authority: a test file that runs in a page is recorded per file, not per case; ' +
            'this run writes the file-level snapshot only.',
        );
      }
    },
  };
}

/**
 * How one file's cases ended, under the names its result gives them: the
 * file's path, and the describe path joined as `currentTestName` joins it for a
 * case in Node.
 */
function caseEnds(file: RstestFileResult) {
  return (file.results ?? []).map((test) => ({
    file: file.testPath, name: caseNameOf(test), id: test.testId, project: file.project, meta: test.meta, stopped: test.status === 'fail',
  }));
}

function caseNameOf(test: { readonly parentNames?: readonly string[]; readonly name?: string }): string {
  return [...(test.parentNames ?? []), test.name].filter(Boolean).join(' > ');
}

function array<T>(value: T | readonly T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? [...value] : [value as T];
}

export { SELECTION_LOADER } from './rstest-loaders.js';
