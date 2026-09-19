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
import { statusesComplete } from './finished-files.js';
import { foldRun } from './selection-fold.js';
import { runFor, runStamp, writeSeamModule } from './selection-run.js';
import { caseGlobalsSource, setupSource } from './worker-source.js';
import { testCoverageFile } from './index.js';

export interface RstestTestSelectionOptions {
  /** Repository root. Defaults to the Rstest config root, then the current directory. */
  readonly root?: string;
  /** Persisted coverage index. Defaults to the repository-keyed user cache. */
  readonly coverageFile?: string;
  /** Decide which bundled modules are product source. */
  readonly include?: (file: string) => boolean;
  /** Additional files whose contents are preconditions of every test observation. */
  readonly preconditions?: readonly string[];
  /**
   * `presence` probes every arrival region; `entries` probes modules and
   * functions only, and costs a fraction of it. Both record which functions
   * ran before the file's first test.
   */
  readonly mode?: InstrumentMode;
  /**
   * Also record which individual test *cases* entered each region, beside the
   * per-file snapshot.
   *
   * Off by default, and that is a measurement rather than caution: the per-case
   * index holds one crossing per case-and-region where the file-level snapshot
   * holds one per file-and-region, so it grows by roughly the number of cases
   * that share a file. CI selects files to run and has no use for the
   * difference; a local loop and a coding agent asking *which five of these two
   * hundred cases walked the branch I changed* have nothing else to ask.
   *
   * Requires `globals: true`: Rstest has no runner option, so the only place a
   * case bracket can be installed is around the registrars themselves, and a
   * suite that imports `it` from `@rstest/core` gets the runner's own binding
   * rather than this one.
   *
   * The snapshot CI reads is unchanged either way — this adds a second artifact
   * beside it, and never alters the first.
   */
  readonly cases?: boolean;
  /** Where the per-case execution index goes. Defaults to `<coverageFile>.cases.json`. */
  readonly executionFile?: string;
}

/** What one test file's run left behind, as Rstest's `onTestRunEnd` reports it. */
export interface RstestFileResult {
  readonly testPath: string;
  readonly status: string;
  readonly results?: ReadonlyArray<{ readonly status: string }>;
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
  const root = resolve(options.root ?? config.root ?? process.cwd());
  const coverageFile = options.coverageFile === undefined
    ? testCoverageFile(root)
    : resolve(root, options.coverageFile);
  const mode = options.mode ?? 'presence';
  const run = runFor(coverageFile, root, mode);
  if (options.cases === true) {
    if (config.globals !== true) {
      throw new Error(
        'withTestSelection was asked to record cases, which under Rstest means wrapping the ' +
          'injected `it` and `test`, and this configuration does not set `globals: true`. Set it, ' +
          'or drop `cases` — the per-file snapshot is recorded either way.',
      );
    }
    run.cases = true;
  }

  // Named for the run rather than for the seam, so two Rstest processes over
  // one project — a watch run beside a CLI one — do not write each other's
  // setup shim, which carries the directory its journals go to.
  const stamp = runStamp(run);
  const setupId = resolve(root, `.variance-authority/test-selection-setup-${stamp}.mjs`);
  run.shims.add(setupId);

  // A `globalSetup` file runs before any test environment exists, so the setup
  // shim that installs the counter factory has never run where one evaluates:
  // instrumented, such a file throws at its first probe and takes the whole
  // suite with it.
  const globalSetup = new Set(array(config.globalSetup).map((file) => resolve(root, file)));
  const chosen = options.include ?? defaultInclude;
  run.include = (file: string): boolean => !globalSetup.has(file) && chosen(file);

  const setupFiles = array(config.setupFiles);
  // A setup entry may be a package — `dotenv/config` — rather than a file of
  // the project's; a package is no precondition a diff can carry, and read as a
  // path it is a missing file that fails the reporter and loses the snapshot.
  for (const file of [
    ...setupFiles.filter((file) => existsSync(resolve(root, file))),
    ...(options.preconditions ?? []),
  ]) run.preconditions.add(resolve(root, file));

  const executionFile = options.executionFile === undefined
    ? `${coverageFile}.cases.json`
    : resolve(root, options.executionFile);
  const settle = foldRun(run, { coverageFile, executionFile, shims: [setupId] });
  const reporter = {
    onTestRunEnd: (payload: { readonly results: readonly RstestFileResult[] }) => settle(
      payload.results.map((file) => ({
        filepath: file.testPath,
        complete: statusesComplete(file.status, (file.results ?? []).map((test) => test.status)),
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

  const scope = options.cases === true ? caseGlobalsSource() : undefined;
  return {
    ...config,
    // First, so a setup file of the project's that loads an instrumented
    // module finds the counter factory its header resolves.
    setupFiles: [
      writeSeamModule(
        setupId,
        setupSource(run.runDirectory, options.cases === true ? run.caseDirectory : undefined, {
          runner: '@rstest/core',
          ...(scope === undefined ? {} : { scope }),
        }),
      ),
      ...setupFiles,
    ],
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

function array<T>(value: T | readonly T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? [...value] : [value as T];
}

export { mergeCoverage } from './merge.js';
