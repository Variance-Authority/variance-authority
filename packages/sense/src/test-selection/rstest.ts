/**
 * Test selection for Rstest: the same probes, journal, and snapshot as the
 * Vitest seam, arranged for a runner that bundles the suite before it runs it.
 *
 * Rstest builds with Rspack, so the two halves are an
 * [`enforce: 'post'` loader](./rstest-loader.ts) and a reporter. Both live in
 * the process Rstest was started in — the loader runs in the main process, not
 * in a worker — so they are joined the way the Vitest seam joins its plugin to
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
import { fileURLToPath } from 'node:url';
import type { InstrumentMode } from '../instrument/index.js';
import { defaultInclude } from './instrumented-modules.js';
import { carriedJournal, statusesComplete } from './finished-files.js';
import { foldRun } from './selection-fold.js';
import { runFor, runStamp, writeSeamModule, type SelectionRun } from './selection-run.js';
import { browserSetupSource, caseGlobalsSource, setupSource } from './worker-source.js';
import { testCoverageFile } from './index.js';
import { repositoryRoot } from './repository-root.js';

export interface RstestTestSelectionOptions {
  /**
   * A directory inside the repository; defaults to the Rstest config root, then
   * the current directory. Names are relative to the checkout it sits in, never
   * to it, and relative option paths resolve against it.
   */
  readonly root?: string;
  /** Persisted coverage index. Defaults to the repository's cache. */
  readonly coverageFile?: string;
  /** Decide which bundled modules are product source. */
  readonly include?: (file: string) => boolean;
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
   * `presence` probes every arrival region; `entries` probes modules and
   * functions only, and costs a fraction of it. Both record which functions
   * ran before the file's first test.
   */
  readonly mode?: InstrumentMode;
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
   * Where the per-case execution index goes. Defaults to `<coverageFile>.cases.bin`;
   * a name ending `.json` is written as JSON instead, at the size JSON costs.
   */
  readonly executionFile?: string;
}

/** What one test file's run left behind, as Rstest's `onTestRunEnd` reports it. */
export interface RstestFileResult {
  readonly testPath: string;
  readonly status: string;
  readonly results?: ReadonlyArray<{ readonly status: string }>;
  /** What the file's own `afterAll` put on its context, carried from wherever it ran. */
  readonly meta?: object;
}

/** The subset of an Rstest configuration this seam reads and rewrites. */
export interface RstestConfig {
  readonly root?: string;
  readonly globals?: boolean;
  readonly setupFiles?: string | readonly string[];
  readonly globalSetup?: string | readonly string[];
  readonly reporters?: unknown;
  readonly projects?: unknown;
  readonly tools?: { readonly rspack?: unknown; readonly [key: string]: unknown };
  readonly [key: string]: unknown;
}

/** The loader an Rstest configuration names, by absolute path. */
export const SELECTION_LOADER = fileURLToPath(new URL('./rstest-loader.js', import.meta.url));

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
  const coverageFile = options.coverageFile === undefined
    ? testCoverageFile(root)
    : resolve(configRoot, options.coverageFile);
  const mode = options.mode ?? 'presence';
  const run = runFor(coverageFile, root, mode);

  // Named for the run rather than for the seam, so two Rstest processes over
  // one project — a watch run beside a CLI one — do not write each other's
  // setup shim, which carries the directory its journals go to.
  const stamp = runStamp(run);
  const setupId = resolve(configRoot, `.variance-authority/test-selection-setup-${stamp}.mjs`);
  run.shims.add(setupId);

  // A `globalSetup` file runs before any test environment exists, so the setup
  // shim that installs the probe log has never run where one evaluates:
  // instrumented, such a file throws at its first probe and takes the whole
  // suite with it.
  const globalSetup = new Set(array(config.globalSetup).map((file) => resolve(configRoot, file)));
  const chosen = options.include ?? defaultInclude;
  run.include = (file: string): boolean => !globalSetup.has(file) && chosen(file);

  const setupFiles = array(config.setupFiles);
  // A setup entry may be a package — `dotenv/config` — rather than a file of
  // the project's; a package is no precondition a diff can carry, and read as a
  // path it is a missing file that fails the reporter and loses the snapshot.
  for (const file of [
    ...setupFiles.filter((file) => existsSync(resolve(configRoot, file))),
    ...(options.preconditions ?? []),
  ]) run.preconditions.add(resolve(configRoot, file));

  const executionFile = options.executionFile === undefined
    ? `${coverageFile}.cases.bin`
    : resolve(configRoot, options.executionFile);
  const settle = foldRun(run, { coverageFile, executionFile, shims: [setupId] });
  const reporter = {
    onTestRunEnd: (payload: { readonly results: readonly RstestFileResult[] }) => settle(
      payload.results.map((file) => ({
        filepath: file.testPath,
        complete: statusesComplete(file.status, (file.results ?? []).map((test) => test.status)),
        ...carriedJournal(file.testPath, file.meta),
      })),
    ),
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
  const scope = caseGlobalsSource(`globalThis, globalThis[${JSON.stringify(RSTEST_API)}]`);
  return {
    ...config,
    // First, so a setup file of the project's that loads an instrumented
    // module finds the probe log its header resolves.
    setupFiles: [
      writeSeamModule(
        setupId,
        setupSource(run.runDirectory, run.caseDirectory, {
          runner: RSTEST_API,
          continuations: options.continuations === true,
          scope,
        }),
      ),
      ...setupFiles,
    ],
    plugins: [...array(config.plugins), pagePlugin(setupId, run, mode)],
    reporters: [...reporters, reporter],
    tools: {
      ...config.tools,
      // Appended to whatever the project configured rather than replacing it:
      // Rsbuild folds an array of these in order, and the rule only has to be
      // present, not first.
      rspack: [
        ...array(config.tools?.rspack),
        {
          module: {
            rules: [
              {
                test: /\.[cm]?[jt]sx?$/,
                // After the project's own loaders and after SWC, so the probes
                // land on JavaScript and the map back to the author's lines is
                // the one the bundler already made.
                enforce: 'post',
                use: [{ loader: SELECTION_LOADER, options: { coverageFile } }],
              },
            ],
          },
        },
      ],
    },
  };
}

/** The part of Rsbuild's plugin API this seam reads. */
interface RsbuildPluginApi {
  readonly useExposed: (id: string) => {
    readonly getRstestConfig: () => { readonly browser?: { readonly enabled?: boolean } };
  } | undefined;
}

/**
 * The setup module for a test file that runs in a page, swapped in where the
 * run says it does.
 *
 * Where a file runs is the runner's to say, and `--browser.enabled` says it
 * after the configuration was written. Rstest hands its Rsbuild plugins the
 * configuration with the command line merged in, so it is read there.
 */
function pagePlugin(setupId: string, run: SelectionRun, mode: InstrumentMode) {
  return {
    name: 'variance-authority:test-selection',
    setup(api: RsbuildPluginApi): void {
      if (api.useExposed('rstest')?.getRstestConfig().browser?.enabled !== true) return;
      writeSeamModule(setupId, browserSetupSource(mode, RSTEST_API));
      // TODO: record cases in a page — a drain per test, carried on each
      // test's `meta` as the file's is.
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

function array<T>(value: T | readonly T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? [...value] : [value as T];
}

export { mergeCoverage } from './merge.js';
