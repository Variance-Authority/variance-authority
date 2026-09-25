/**
 * Journey coverage and test selection for Jest, arranged for a runner whose
 * transform runs in a worker it forks.
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
 *   gives every instrumented module the log it writes into, and writes one
 *   journal per test file to disk in `afterAll`. Nothing crosses the worker's IPC channel,
 *   which is where a coverage map of the whole run goes out of memory.
 * - [`jest-reporter.ts`](./jest-reporter.ts) names the run directory before the
 *   workers fork. A journey-only run seals its journals for a post-Jest fold;
 *   a test-selection run still folds its file-level journals into its snapshot.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { InstrumentMode } from '../instrument/index.js';
import { testCoverageFile } from './index.js';
import { repositoryRoot } from './repository-root.js';

export interface JestTestSelectionOptions {
  /**
   * A directory inside the repository; defaults to `rootDir`, then the current
   * directory. Names are relative to the checkout it sits in, never to it, and
   * relative option paths resolve against it.
   */
  readonly root?: string;
  /** Persisted coverage index. Defaults to the repository's cache. */
  readonly coverageFile?: string;
  /**
   * Additional files whose contents are preconditions of every test observation.
   * Jest transforms these files normally but Sense does not place probes in them,
   * because a precondition may run before the collector exists.
   *
   * The configured environment and setup files are declared already; the config
   * file is not, because Jest hands no transformer or reporter the path it
   * loaded — its global and project configs carry what the file said, never
   * where it was. Name the config file here, and any local module it imports.
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

/** Record per-test journeys from Jest without creating a test-selection snapshot. */
export interface JestJourneyCoverageOptions {
  /**
   * A directory inside the repository; defaults to `rootDir`, then the current
   * directory. Names are relative to the checkout it sits in, never to it, and
   * relative option paths resolve against it.
   */
  readonly root?: string;
  /** Native per-test journey artifact written by `variance journeys finalize` after Jest. */
  readonly journeyFile: string;
  /** Files Jest transforms before the probe log exists; transformed, but never probed. */
  readonly preconditions?: readonly string[];
  /** Probe recipe. Defaults to every arrival region. */
  readonly mode?: InstrumentMode;
  /** Follow deliberately concurrent tests through their async contexts. */
  readonly continuations?: boolean;
}

/** The subset of a Jest configuration this seam reads and rewrites. */
export interface JestConfig {
  readonly rootDir?: string;
  readonly cacheDirectory?: string;
  readonly testEnvironment?: string;
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
  /** Absolute paths Jest evaluates before `setupFiles` can install the probe collector. */
  readonly exclude?: readonly string[];
  /** The probe recipe; `presence` when absent. */
  readonly mode?: InstrumentMode;
}

/** What the reporter is handed. */
export interface SelectionReporterConfig {
  readonly root: string;
  readonly coverageFile: string;
  /**
   * Absolute paths of every project's setup and environment files and every
   * declared precondition: what a test rests on when Jest did not say which
   * project ran it.
   */
  readonly preconditions: readonly string[];
  /** Absolute paths of the preconditions declared for every test, whichever project ran it. */
  readonly declared?: readonly string[];
  /** The probe recipe the transforms placed; `presence` when absent. */
  readonly mode?: InstrumentMode;
  /** Whether that recording follows each case through the async context, and names the runaways. */
  readonly continuations?: boolean;
  /** Where the per-case execution index goes; `<coverageFile>.cases.bin` when absent. */
  readonly executionFile?: string;
}

/** What the reporter is handed when it records journeys and nothing else. */
interface JourneyReporterConfig {
  readonly root: string;
  readonly journeyFile: string;
  readonly mode?: InstrumentMode;
  readonly continuations?: boolean;
}

/** The variable the reporter sets before workers fork, and the setup file reads. */
export const RUN_DIRECTORY_VARIABLE = 'VARIANCE_AUTHORITY_TEST_SELECTION_RUN';

/**
 * The variable that both names where case frames go and says they are wanted.
 *
 * Set beside the run directory, before the workers fork, and read twice in the
 * sandbox: once by `jest-globals.cts`, which has to choose its collector before
 * the first probe resolves, and once by `jest-setup.cts`, which writes there.
 * One variable rather than a flag and a path, because a collector that scoped
 * its log by case and a writer with nowhere to put them is a suite paying for an
 * answer nobody reads.
 */
export const CASE_DIRECTORY_VARIABLE = 'VARIANCE_AUTHORITY_TEST_SELECTION_CASES';

/**
 * Set beside it when the case scope is an async context rather than a
 * variable, read once by `jest-globals.cts` when it picks a collector.
 *
 * A separate variable rather than a second value in the first, because the two
 * answer different questions — *is anything per-case recorded* and *how is the
 * case bracket held* — and a path that also encodes a mode is a path a reader
 * has to parse before believing.
 */
export const CONTINUATIONS_VARIABLE = 'VARIANCE_AUTHORITY_TEST_SELECTION_CONTINUATIONS';

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
 * order and gain one file at the start — the probe log's root every probe
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
  const rootDir = resolve(options.root ?? config.rootDir ?? process.cwd());
  const root = repositoryRoot(rootDir);
  const coverageFile = options.coverageFile === undefined
    ? testCoverageFile(root)
    : resolve(rootDir, options.coverageFile);
  const inline = inlineProjects(config);
  const mode = options.mode;
  const declared = (options.preconditions ?? []).map((file) => resolve(rootDir, file));
  const projects = inline?.map((project) =>
    instrumented(project, root, projectRoot(project, rootDir), mode, declared));
  const preconditions = [
    ...environmentPaths(config, rootDir),
    ...setupPaths(config, rootDir),
    ...(inline ?? []).flatMap((project) => environmentPaths(project, projectRoot(project, rootDir))),
    ...(inline ?? []).flatMap((project) => setupPaths(project, projectRoot(project, rootDir))),
    ...declared,
  ];
  const reporter: SelectionReporterConfig = {
    root,
    coverageFile,
    preconditions: [...new Set(preconditions)],
    ...(declared.length === 0 ? {} : { declared }),
    ...(mode === undefined ? {} : { mode }),
    ...(options.continuations === true ? { continuations: true } : {}),
    ...(options.executionFile === undefined
      ? {}
      : { executionFile: resolve(rootDir, options.executionFile) }),
  };

  return {
    ...(projects === undefined ? instrumented(config, root, rootDir, mode, declared) : config),
    rootDir: config.rootDir ?? rootDir,
    ...(projects === undefined ? {} : { projects }),
    reporters: [...(config.reporters ?? ['default']), [SELECTION_REPORTER, { ...reporter }]],
  };
}

/**
 * Record the arrival regions entered by each Jest test as a native journey
 * artifact, without reading or writing a test-selection snapshot.
 */
export function withJourneyCoverage(
  config: JestConfig,
  options: JestJourneyCoverageOptions,
): JestConfig {
  const rootDir = resolve(options.root ?? config.rootDir ?? process.cwd());
  const root = repositoryRoot(rootDir);
  const inline = inlineProjects(config);
  const declared = (options.preconditions ?? []).map((file) => resolve(rootDir, file));
  const projects = inline?.map((project) =>
    instrumented(project, root, projectRoot(project, rootDir), options.mode, declared));
  const reporter: JourneyReporterConfig = {
    root,
    journeyFile: resolve(rootDir, options.journeyFile),
    ...(options.mode === undefined ? {} : { mode: options.mode }),
    ...(options.continuations === true ? { continuations: true } : {}),
  };

  return {
    ...(projects === undefined ? instrumented(config, root, rootDir, options.mode, declared) : config),
    rootDir: config.rootDir ?? rootDir,
    ...(projects === undefined ? {} : { projects }),
    reporters: [...(config.reporters ?? ['default']), [SELECTION_REPORTER, { ...reporter }]],
  };
}

function inlineProjects(config: JestConfig): readonly JestConfig[] | undefined {
  return config.projects?.map((project) => {
    if (typeof project === 'string') {
      throw new Error(
        `the Jest project named by path ${JSON.stringify(project)} cannot be instrumented: ` +
          'a project\'s `transform` and setup files are its own, and a path is read by Jest after ' +
          'this returns. Spell the project inline in `projects`, and every one of them is instrumented.',
      );
    }
    return project;
  });
}

/**
 * The halves of a configuration Jest reads per project: the transform that
 * places the probes and the two setup phases that install the probe log and
 * write the journal. Reporters are the run's, not a project's — Jest ignores
 * a project's — so they are added once, above.
 */
function instrumented(
  config: JestConfig,
  root: string,
  rootDir: string,
  mode: InstrumentMode | undefined,
  declared: readonly string[],
): JestConfig {
  const configured = config.transform === undefined
    ? { [DEFAULT_PATTERN]: 'babel-jest' }
    : Object.keys(config.transform).length === 0
      ? { [DEFAULT_PATTERN]: undefined }
      : config.transform;
  // FIXME: A custom environment's repository-owned dependency closure still
  // runs before `setupFiles` and is therefore probed before the collector exists.
  // The configured entry is safe; the closure needs an owner before this can
  // claim environments composed from other workspace packages.
  const exclude = [...new Set([...environmentPaths(config, rootDir), ...declared])];
  const transform = Object.fromEntries(
    Object.entries(configured).map(([pattern, transformer]): [string, readonly [string, Record<string, unknown>]] => [
      pattern,
      [
        SELECTION_TRANSFORM,
        {
          root,
          ...(transformer === undefined ? {} : { transformer }),
          ...(exclude.length === 0 ? {} : { exclude }),
          ...(mode === undefined ? {} : { mode }),
        },
      ],
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
    .flatMap((file) => configuredPath(file, rootDir));
}

/** A custom environment runs before `setupFiles`, so it is an input and never probed source. */
function environmentPaths(config: JestConfig, rootDir: string): readonly string[] {
  return config.testEnvironment === undefined ? [] : configuredPath(config.testEnvironment, rootDir);
}

/** Resolve one configuration entry only when it names a file rather than a package. */
function configuredPath(file: string, rootDir: string): readonly string[] {
  return file.startsWith('<rootDir>') || file.startsWith('.') || file.startsWith('/')
    ? [resolve(rootDir, file.replace(/^<rootDir>\/?/, ''))]
    : [];
}

/**
 * Where one Jest project keeps its module records, inside Jest's own cache.
 *
 * Inside the cache directory so that `jest --clearCache` discards the
 * transformed text and the records of what its ordinals mean together, and
 * under the project id so two projects that transform one file differently do
 * not take turns overwriting each other. `id` is Jest's own hash of the project
 * configuration, which is exactly the question a store has to answer: which
 * build produced this text.
 */
export function jestStore(cacheDirectory: string, id = 'project'): string {
  return resolve(cacheDirectory, 'variance-authority-test-selection', id);
}

export { mergeCoverage } from './merge.js';
