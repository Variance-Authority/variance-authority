import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, relative, resolve, sep } from 'node:path';
import type { Reporter } from 'vitest/reporters';
import type { UserConfig } from 'vitest/config';
import { instrument, type InstrumentMode } from '../instrument/index.js';
import { priorMap, type TransformingContext } from './probes.js';
import { cleanId, defaultInclude, projectPath } from './instrumented-modules.js';
import { coverageBlock } from './coverage-rows.js';
import { recordedFrame } from './source-lines.js';
import {
  carriedJournal,
  reportedComplete,
  taskComplete,
  type ReportedModule,
  type RunnerTask,
} from './finished-files.js';
import { browserSetupSource, caseRunnerSource, setupSource } from './worker-source.js';
import { foldRun } from './selection-fold.js';
import { runFor, runStamp, writeSeamModule, type SelectionRun } from './selection-run.js';
import { testCoverageFile } from './index.js';
import { repositoryRoot } from './repository-root.js';

export interface TestSelectionOptions {
  /**
   * A directory inside the repository; defaults to the Vitest config root, then
   * the current directory. Names are relative to the checkout it sits in, never
   * to it, and relative option paths resolve against it.
   */
  readonly root?: string;
  /** Persisted coverage index. Defaults to the repository-keyed user cache. */
  readonly coverageFile?: string;
  /** Decide which transformed modules are product source. */
  readonly include?: (file: string) => boolean;
  /**
   * Files whose contents are preconditions of every test observation, beside
   * the ones the seam declares on its own: the config file Vite loaded, the
   * local modules it bundled into it, and the configured setup files. Name a
   * file the runner reads without Vite knowing — compiler settings, a fixture
   * read with `fs`.
   */
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
   * The snapshot CI reads is unchanged either way — this adds a second artifact
   * beside it, and never alters the first.
   */
  readonly cases?: boolean;
  /**
   * Follow each case through the async context, and name the cases whose work
   * outlived them.
   *
   * Without it, `cases` assumes what a suite almost always is: one case at a
   * time. The case running now is a variable, the probe reads a closure slot
   * for it, and per-case recording costs what the per-file recording costs. A
   * second case opening while one is still open is then refused rather than
   * guessed at, because the guess charges one case's crossings to another and a
   * case credited with less than it reached is a case a change can skip.
   *
   * With it, each case gets an async context instead, which follows its
   * continuations wherever they settle and gives concurrent cases a bucket
   * each. Reading which continuation is running costs 4.7 nanoseconds a
   * crossing over the variable, which a microbenchmark separates and a real
   * suite does not: over zod's 5,656 cases the crossing count predicts 0.2%,
   * and the runs do not resolve it. What you buy for it is the list of cases
   * that made a crossing after they had settled, printed when the file ends:
   * the tests that are still running when the next one starts.
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

/** What Vite resolved, as far as the seam reads it. */
interface ResolvedViteConfig {
  readonly configFile: string | undefined;
  readonly configFileDependencies: readonly string[];
}

interface ConfigPlugin {
  readonly name: string;
  readonly configResolved: (config: ResolvedViteConfig) => void;
}

/** The part of the configuration Vite hands a plugin that decides where a file runs. */
interface TestConfig {
  test?: { browser?: { enabled?: boolean }; runner?: string };
}

interface VitePlugin extends ConfigPlugin {
  readonly enforce: 'post';
  readonly config: (config: TestConfig) => void;
  readonly transform: (
    this: TransformingContext,
    code: string,
    id: string,
  ) => { code: string; map: null } | null;
}

/**
 * Add source instrumentation, test-file attribution, and coverage persistence to
 * an ordinary Vitest configuration.
 *
 * Applies to a single configuration, and to both halves of a `projects` layout:
 * wrap the root config and each project config that should be recorded, and the
 * run they describe is one run.
 */
export function withTestSelection(
  config: UserConfig = {},
  options: TestSelectionOptions = {},
): UserConfig {
  const configRoot = resolve(options.root ?? config.root ?? process.cwd());
  const root = repositoryRoot(configRoot);
  const coverageFile = options.coverageFile === undefined
    ? testCoverageFile(root)
    : resolve(configRoot, options.coverageFile);
  const mode = options.mode ?? 'presence';
  const run = runFor(coverageFile, root, mode);
  if (options.cases === true) run.cases = true;
  // Named for the run rather than for the seam. These are files on disk now, so
  // two Vitest processes over one project — a watch run beside a CLI one, or
  // this repository's own integration tests — would otherwise write each other's
  // setup shim, and a shim carries the directory its journals go to. The run
  // directory already carries a pid and a uuid; the same stamp names the shim.
  const stamp = runStamp(run);
  const setupId = resolve(configRoot, `.variance-authority/test-selection-setup-${stamp}.mjs`);
  const runnerId = resolve(configRoot, `.variance-authority/test-selection-case-runner-${stamp}.mjs`);
  // A `globalSetup` file runs once, in the Vitest process, before any test
  // environment exists — the setup shim that installs `globalThis.__VA__` is a
  // `setupFiles` entry and has never run there. Instrumented, such a file
  // throws at its first probe and takes the whole suite with it before a single
  // test loads. The resolved config names these files, so they are excluded by
  // path rather than guessed at from their names; `defaultInclude` carries the
  // filename-shaped backstop for config files themselves.
  const globalSetup = new Set(
    array((config.test as { globalSetup?: string | readonly string[] } | undefined)?.globalSetup)
      .filter((file): file is string => typeof file === 'string')
      .map((file) => resolve(configRoot, file)),
  );
  const chosen = options.include ?? defaultInclude;
  const include = (file: string): boolean => !globalSetup.has(file) && chosen(file);
  const setupFiles = array(config.test?.setupFiles);
  // A setup entry may be a package — `dotenv/config` — rather than a file of
  // the project's; a package is no precondition a diff can carry, and read as a
  // path it is a missing file that fails the reporter and loses the snapshot.
  for (const file of [
    ...setupFiles.filter((file): file is string => typeof file === 'string' && existsSync(resolve(configRoot, file))),
    ...(options.preconditions ?? []),
  ]) run.preconditions.add(resolve(configRoot, file));

  const executionFile = options.executionFile === undefined
    ? `${coverageFile}.cases.bin`
    : resolve(configRoot, options.executionFile);
  const reporter = selectionReporter(coverageFile, executionFile, run, [setupId, runnerId]);
  const reporters = config.test?.reporters === undefined ? ['default'] : array(config.test.reporters);

  // A configuration that names projects describes the run rather than a suite:
  // nothing is transformed under it, and it is the only place a reporter is
  // read from. The instrumenting plugin and the setup file would sit on a
  // config that loads no test file; what it carries is its own file, which
  // governs every project it lists.
  // `projects` is Vitest 3 and 4's name for it; Vitest 2 called the same idea
  // `workspace`. Read structurally, because the seam is built against one of
  // them and run against whichever the project installed.
  const describesProjects = (config.test as { projects?: unknown } | undefined)?.projects !== undefined;
  if (describesProjects) {
    return {
      ...config,
      plugins: [...array(config.plugins), {
        name: 'variance-authority:test-selection-config',
        configResolved: declareConfig(run.preconditions),
      } satisfies ConfigPlugin],
      test: { ...config.test, reporters: [...reporters, reporter] },
    };
  }

  const plugin = selectionPlugin(root, setupId, runnerId, run, include, mode);
  return {
    ...config,
    plugins: [...array(config.plugins), plugin],
    test: {
      ...config.test,
      // First, so a setup file of the project's that loads an instrumented
      // module finds the probe log's root its header resolves. On disk rather
      // than virtual — see {@link writeSeamModule}.
      setupFiles: [
        writeSeamModule(
          setupId,
          setupSource(run.runDirectory, options.cases === true ? run.caseDirectory : undefined, {
            continuations: options.continuations === true,
          }),
        ),
        ...setupFiles,
      ],
      // Kept for a single-configuration project, where this config is the root
      // one as well and its reporters are the ones that run.
      reporters: [...reporters, reporter],
      // A runner of the project's own is left alone rather than replaced: a case
      // scope is worth less than a suite that runs. Per-case recording then has
      // no bracket and records the file as one ambient bucket, which is the
      // file-level answer it already had.
      ...(options.cases === true && config.test?.runner === undefined
        ? {
          runner: writeSeamModule(runnerId, caseRunnerSource({
            module: runnerImport(configRoot, runnerId, '@vitest/runner'),
            utils: runnerImport(configRoot, runnerId, '@vitest/runner/utils'),
          })),
        }
        : {}),
    },
  };
}

/**
 * How the case runner should spell a package of Vitest's own.
 *
 * The runner is a file in the project root, and `@vitest/runner` is Vitest's
 * dependency rather than the project's. A layout that hoists answers a bare
 * specifier there and pnpm's does not: the import resolves to nothing, every
 * test file fails to load, and the run reports the files that needed no runner
 * as a pass. Measured on TanStack Query, where 25 of 188 files ran and the
 * suite went green in a third of the time.
 *
 * So the specifier is resolved from Vitest — which every project that runs one
 * can resolve — and the runner is handed a path to that file. Asking the root
 * first is not the cheaper check it looks like: inside the process that loads a
 * Vitest config the bare specifier resolves under pnpm as well, and the file
 * the runner is written to still cannot resolve it.
 *
 * Relative rather than absolute, because a leading slash is root-relative to
 * Vite. To the file Vitest itself loads, because a second copy of
 * `@vitest/runner` is a second `getFn` over a different map, and that one
 * answers `undefined` for every task.
 */
function runnerImport(root: string, runnerId: string, specifier: string): string {
  try {
    const fromRoot = createRequire(resolve(root, 'package.json'));
    const file = createRequire(fromRoot.resolve('vitest')).resolve(specifier);
    const path = relative(dirname(runnerId), file).split(sep).join('/');
    return path.startsWith('.') ? path : `./${path}`;
  } catch {
    return specifier;
  }
}

/**
 * Declare the configuration Vite loaded as a precondition of every test, the
 * way a setup file is declared.
 *
 * Asked of Vite, which read the file, rather than of the command line or a
 * list of likely names: `configFile` is the file it loaded, and
 * `configFileDependencies` the local modules it bundled into that file — the
 * set Vite restarts the server over. A package the config imports stays
 * outside it, as it does when Vite bundles, and is read as the install. A
 * configuration handed to Vitest inline has no file, and declares nothing.
 */
function declareConfig(preconditions: Set<string>): (config: ResolvedViteConfig) => void {
  return ({ configFile, configFileDependencies }) => {
    for (const file of [...(configFile === undefined ? [] : [configFile]), ...configFileDependencies]) {
      preconditions.add(resolve(file));
    }
  };
}

function selectionPlugin(
  root: string,
  setupId: string,
  runnerId: string,
  run: SelectionRun,
  include: (file: string) => boolean,
  mode: InstrumentMode,
): VitePlugin {
  const { modules, names, preconditions } = run;
  return {
    name: 'variance-authority:test-selection',
    enforce: 'post',
    // Where a file runs is the runner's to say, and `--browser` says it after
    // the configuration was written, so it is read here, where the command line
    // has already been merged in. A file in a page has no disk, no builtins and
    // no runner of this seam's: its setup module hands the runner what it ran.
    // TODO: record cases in a page — a drain per test in `beforeEach` and
    // `afterEach`, carried on each test's `meta` as the file's is.
    config(config) {
      if (config.test?.browser?.enabled !== true) return;
      writeSeamModule(setupId, browserSetupSource(mode));
      if (config.test.runner === runnerId) delete config.test.runner;
      // An index with no case in it answers *which cases walk this line* with
      // none, so a run that recorded no case writes no index.
      if (run.cases) {
        run.cases = false;
        console.warn(
          'variance-authority: `cases` is not recorded for a test file that runs in a page; ' +
            'this run writes the file-level snapshot only.',
        );
      }
    },
    configResolved: declareConfig(preconditions),
    transform(code, id) {
      // The setup module installs the probe log; instrumented, its own header
      // would ask for the log's root before the module has installed it.
      // The runner module is this seam's too, and both sit under the root the
      // default include reaches. Compared after the query suffix is stripped,
      // because the runner is a file on disk now and a real file is the kind of
      // id a bundler decorates.
      const file = cleanId(id);
      if (file === setupId || file === runnerId) return null;
      if (!include(file)) return null;
      // The digest is of the text on disk, which is what the block lines are
      // coordinates in once the prior transforms' maps are read back through —
      // and of `code`, which is what those transforms made of it, when there is
      // no map to read back through and the lines stay where they were left.
      const { lineOf, sourceDigest, file: wrote } = recordedFrame(
        code,
        priorMap(this),
        file,
        (at) => readFileSync(at, 'utf8'),
      );

      // Under its id, the same one every other seam instruments under, so a
      // journal reads the same whoever produced it. Vitest re-transforms every
      // run in this process, so the records stay in this map rather than going
      // to the store a build needs — writing two hundred thousand files to read
      // them back a second later is ceremony, not durability.
      const name = projectPath(root, wrote);
      const moduleId = names.idOf(name) ?? name;
      const done = instrument(code, name, moduleId, { mode });
      if (done === undefined) {
        modules.set(moduleId, { file: name, id: moduleId, sourceDigest, instrumented: false, blocks: [] });
        return null;
      }

      modules.set(moduleId, {
        file: name,
        id: moduleId,
        sourceDigest,
        instrumented: true,
        blocks: done.blocks.map((block) => coverageBlock(code, block, lineOf)),
      });
      return { code: done.code, map: null };
    },
  };
}

function selectionReporter(
  coverageFile: string,
  executionFile: string,
  run: SelectionRun,
  shims: readonly string[],
): Reporter {
  const settle = foldRun(run, { coverageFile, executionFile, shims });

  // Vitest 2 announces the end of a run as `onFinished(files)`, where a file is
  // a runner task. Vitest 3 replaced that with `onTestRunEnd(testModules)` over
  // a reported-task API, and Vitest 4 stopped calling `onFinished` on reporters
  // altogether — silently, because a reporter with no hook a runner recognises
  // is a reporter that never objects. A suite would go green and write no
  // snapshot. Both hooks are declared, both narrow to the same two facts, and
  // whichever the runner calls first is the one that counts.
  return {
    onFinished: (files: readonly RunnerTask[]) => settle(
      files.flatMap((file) => file.filepath === undefined
        ? []
        : [{
          filepath: file.filepath,
          complete: taskComplete(file),
          ...carriedJournal(file.filepath, file.meta),
        }]),
    ),
    onTestRunEnd: (reported: readonly ReportedModule[]) => settle(
      reported.map((module) => ({
        filepath: module.moduleId,
        complete: reportedComplete(module),
        ...carriedJournal(module.moduleId, module.meta?.()),
      })),
    ),
  } as Reporter;
}

function array<T>(value: T | readonly T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? [...value] : [value as T];
}

export { mergeCoverage } from './merge.js';
