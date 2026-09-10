/**
 * Test selection for Jest: the same probes, journal, and snapshot as the Vitest
 * seam, arranged for a runner whose transform runs in a worker it forks.
 *
 * Vitest hands one plugin a `transform` hook and a reporter in one process, so
 * the blocks a transform found can sit in a `Map` until the reporter reads them.
 * Jest transforms inside `jest-worker` children, caches the transformed text on
 * disk keyed by content, and on a warm run never calls the transformer at all.
 * So the three halves here never share memory, and the seam is three files the
 * configuration names by path:
 *
 * - [`jest-transform.ts`](./jest-transform.ts) wraps the project's own
 *   transformer, places probes on its output, and writes what the ordinals mean
 *   to an inventory keyed by the same cache key Jest stores the text under. A
 *   warm run pays neither the transform nor the parse.
 * - [`jest-setup.cts`](./jest-setup.cts) runs inside each test file's sandbox,
 *   hands every instrumented module its counters, and writes one journal per
 *   test file to disk in `afterAll`. Nothing crosses the worker's IPC channel,
 *   which is where a coverage map of the whole run goes out of memory.
 * - [`jest-reporter.ts`](./jest-reporter.ts) names the run directory before the
 *   workers fork, then folds the journals against the inventories and lands the
 *   result through `mergeCoverage` and `writeTestCoverage`.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { testCoverageFile } from './index.js';

export interface JestTestSelectionOptions {
  /** Repository root. Defaults to `rootDir`, then the current directory. */
  readonly root?: string;
  /** Persisted coverage index. Defaults to the repository-keyed user cache. */
  readonly coverageFile?: string;
  /** Additional files whose contents are preconditions of every test observation. */
  readonly preconditions?: readonly string[];
}

/** The subset of a Jest configuration this seam reads and rewrites. */
export interface JestConfig {
  readonly rootDir?: string;
  readonly cacheDirectory?: string;
  readonly setupFiles?: readonly string[];
  readonly setupFilesAfterEnv?: readonly string[];
  readonly reporters?: ReadonlyArray<string | readonly [string, Record<string, unknown>]>;
  readonly transform?: Readonly<Record<string, string | readonly [string, Record<string, unknown>]>>;
  readonly projects?: ReadonlyArray<string | JestConfig>;
  readonly [key: string]: unknown;
}

/** What one transform entry hands the wrapping transformer. */
export interface SelectionTransformerConfig {
  readonly root: string;
  /** The transformer this one wraps, as the configuration spelled it; absent runs plain JavaScript. */
  readonly transformer?: string | readonly [string, Record<string, unknown>];
}

/** What the reporter is handed. */
export interface SelectionReporterConfig {
  readonly root: string;
  readonly coverageFile: string;
  /** Absolute paths of every configured setup file and declared precondition. */
  readonly preconditions: readonly string[];
}

/** The variable the reporter sets before workers fork, and the setup file reads. */
export const RUN_DIRECTORY_VARIABLE = 'VARIANCE_AUTHORITY_TEST_SELECTION_RUN';

/** Jest's pattern for the modules it transforms when nothing is configured. */
const DEFAULT_PATTERN = '\\.[jt]sx?$';

const here = (name: string): string => fileURLToPath(new URL(name, import.meta.url));

/** The three modules a Jest configuration names, by absolute path. */
export const SELECTION_TRANSFORM = here('./jest-transform.js');
export const SELECTION_GLOBALS = here('./jest-globals.cjs');
export const SELECTION_SETUP = here('./jest-setup.cjs');
export const SELECTION_REPORTER = here('./jest-reporter.js');

/**
 * Add source instrumentation, test-file attribution, and coverage persistence to
 * an ordinary Jest configuration.
 *
 * ```js
 * // jest.config.mjs
 * import { withTestSelection } from '@variance-authority/sense/jest';
 *
 * export default withTestSelection({
 *   testEnvironment: 'jsdom',
 *   transform: { '\\.[jt]sx?$': ['@swc/jest', { jsc: { parser: { syntax: 'typescript', tsx: true } } }] },
 * });
 * ```
 *
 * Everything the configuration already had stays. Its `setupFiles` keep their
 * order and gain one file at the start — the counter factory every probe
 * resolves, which has to be there before a setup file of the project's loads
 * an instrumented module — and its `setupFilesAfterEnv` keep theirs and gain
 * the journal writer at the end; its `reporters` keep theirs and gain one at
 * the end, and a configuration with none keeps Jest's default reporter. Every `transform` entry is kept and
 * wrapped: the project's transformer still runs first, on the same pattern with
 * the same options, and probes land on what it produced. A configuration with
 * no `transform` gets what Jest would have given it, `babel-jest` over Jest's
 * default pattern, wrapped the same way; one that set `transform: {}` to run
 * plain JavaScript is instrumented directly.
 */
export function withTestSelection(
  config: JestConfig = {},
  options: JestTestSelectionOptions = {},
): JestConfig {
  const root = resolve(options.root ?? config.rootDir ?? process.cwd());
  const coverageFile = options.coverageFile === undefined
    ? testCoverageFile(root)
    : resolve(root, options.coverageFile);
  const inline = config.projects?.map((project) => {
    if (typeof project === 'string') {
      throw new Error(
        `withTestSelection cannot instrument the Jest project named by path ${JSON.stringify(project)}: ` +
          'a project\'s `transform` and setup files are its own, and a path is read by Jest after this ' +
          'returns. Spell the project inline in `projects`, and every one of them is instrumented.',
      );
    }
    return project;
  });
  const projects = inline?.map((project) => instrumented(project, root, projectRoot(project, root)));
  const preconditions = [
    ...setupPaths(config, root),
    ...(inline ?? []).flatMap((project) => setupPaths(project, projectRoot(project, root))),
    ...(options.preconditions ?? []).map((file) => resolve(root, file)),
  ];
  const reporter: SelectionReporterConfig = { root, coverageFile, preconditions: [...new Set(preconditions)] };

  return {
    ...(projects === undefined ? instrumented(config, root, root) : config),
    rootDir: config.rootDir ?? root,
    ...(projects === undefined ? {} : { projects }),
    reporters: [...(config.reporters ?? ['default']), [SELECTION_REPORTER, { ...reporter }]],
  };
}

/**
 * The halves of a configuration Jest reads per project: the transform that
 * places the probes and the two setup phases that install the factory and
 * write the journal. Reporters are the run's, not a project's — Jest ignores
 * a project's — so they are added once, above.
 */
function instrumented(config: JestConfig, root: string, rootDir: string): JestConfig {
  const configured = config.transform === undefined
    ? { [DEFAULT_PATTERN]: 'babel-jest' }
    : Object.keys(config.transform).length === 0
      ? { [DEFAULT_PATTERN]: undefined }
      : config.transform;
  const transform = Object.fromEntries(
    Object.entries(configured).map(([pattern, transformer]): [string, readonly [string, Record<string, unknown>]] => [
      pattern,
      [SELECTION_TRANSFORM, { root, ...(transformer === undefined ? {} : { transformer }) }],
    ]),
  );

  return {
    ...config,
    rootDir,
    transform,
    setupFiles: [SELECTION_GLOBALS, ...(config.setupFiles ?? [])],
    setupFilesAfterEnv: [...(config.setupFilesAfterEnv ?? []), SELECTION_SETUP],
  };
}

/** A project's `rootDir`, absolute, with the top level's `<rootDir>` spelled out; the top level's own when it has none. */
function projectRoot(project: JestConfig, root: string): string {
  return resolve(root, (project.rootDir ?? '.').replace(/^<rootDir>\/?/, ''));
}

/**
 * The setup entries that are files of the project's, as absolute paths.
 *
 * Jest resolves a setup entry the way `require` would: `<rootDir>/…`, `./…`
 * and `/…` are paths, and anything else — `jest-canvas-mock`, `dotenv/config`
 * — is a package. A package is not a precondition a diff can carry, and
 * reading it as a path is a missing file that fails the reporter and loses the
 * run's snapshot entirely.
 */
function setupPaths(config: JestConfig, rootDir: string): readonly string[] {
  return [...(config.setupFiles ?? []), ...(config.setupFilesAfterEnv ?? [])]
    .filter((file) => file.startsWith('<rootDir>') || file.startsWith('.') || file.startsWith('/'))
    .map((file) => resolve(rootDir, file.replace(/^<rootDir>\/?/, '')));
}

/**
 * Where the inventories live: inside Jest's own cache, so `jest --clearCache`
 * discards the two halves of one transform together.
 *
 * Keyed by the cache key Jest stores the transformed text under, which is the
 * content, the path, and every option that shaped the output. A transformed
 * module and the record of what its ordinals mean are therefore one artifact
 * under two names, and a run that hits Jest's cache finds the inventory that
 * exact text was written with — whatever process wrote it, and whenever.
 */
export function inventoryFile(cacheDirectory: string, cacheKey: string): string {
  return resolve(cacheDirectory, 'variance-authority-test-selection', `${cacheKey}.json`);
}

export { mergeCoverage } from './merge.js';
