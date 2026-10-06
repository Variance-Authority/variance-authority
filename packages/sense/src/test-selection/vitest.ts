import { existsSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, relative, resolve, sep } from 'node:path';
import type { Reporter } from 'vitest/reporters';
import type { UserConfig } from 'vitest/config';
import { instrument, type InstrumentMode } from '../instrument/index.js';
import { priorMap, type TransformingContext } from './probes.js';
import { cleanId, defaultInclude, projectPath } from './instrumented-modules.js';
import { coverageBlock } from './coverage-rows.js';
import { includedFrame } from './source-lines.js';
import {
  carriedJournal,
  readFinished,
  reportedDuration,
  reportedComplete,
  runnerSkipped,
  taskComplete,
  type FinishedFile,
  type ReportedModule,
  type RunnerTask,
} from './finished-files.js';
import { browserSetupSource, caseRunnerSource, setupSource } from './worker-source.js';
import { foldRun } from './selection-fold.js';
import { reportedCases, taskCases } from './case-durations.js';
import {
  declareConfig,
  noteRunner,
  projectConfig,
  type ResolvedViteConfig,
  type RunnerContext,
} from './governing-config.js';
import { removeSeamModules, reopenRun, runFor, runStamp, writeSeamModule, type SelectionRun } from './selection-run.js';
import { recordFileFor } from './record-location.js';
import { repositoryRoot } from './repository-root.js';
import { askedForStories } from '../story/directory.js';

export interface TestSelectionOptions {
  /**
   * A directory inside the repository; defaults to the Vitest config root, then
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
   * Follow each case through the async context, and name the cases whose work
   * outlived them.
   *
   * Without it, the case recording assumes what a suite almost always is: one
   * case at a time. The case running now is a variable, the probe reads a closure slot
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
   * the tests that are still running when the next one starts.
   *
   * Turn it on to find those, and to record a suite that is deliberately
   * concurrent. Leave it off the rest of the time.
   */
  readonly continuations?: boolean;
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
  readonly closeBundle: () => Promise<void>;
  readonly watchChange: (id: string) => void;
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
  const coverageFile = recordFileFor(root, configRoot, options);
  const mode = options.mode ?? 'presence';
  const run = runFor(coverageFile, root, mode);
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
  const include = options.include ?? defaultInclude;
  const setupFiles = array(config.test?.setupFiles);
  // What the author declared is declared for the tests this configuration
  // governs, which for the one that describes the run is every test.
  const declared = (options.preconditions ?? []).map((file) => resolve(configRoot, file));

  const settle = foldRun(run, { coverageFile, shims: [setupId, runnerId] });
  const reporter = selectionReporter(run, settle);
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
        configResolved: declareConfig(run, declared, [setupId, runnerId]),
      } satisfies ConfigPlugin],
      test: { ...config.test, reporters: [...reporters, reporter] },
    };
  }

  const plugin = selectionPlugin(root, setupId, runnerId, globalSetup, run, include, mode, declared, settle);
  // The realm's engine is decided once, by whichever of the two shims installs
  // it first, so both are handed the same answers.
  const continuations = options.continuations === true;
  const story = askedForStories(coverageFile);
  return {
    ...config,
    plugins: [...array(config.plugins), plugin],
    test: {
      ...config.test,
      // First, so what a setup file of the project's loads is logged into the
      // file's own bucket: before the shim opens it, a probe in a realm that
      // already ran a file writes into the idle one, and under a runner of the
      // project's own finds no root at all.
      // On disk rather than virtual — see {@link writeSeamModule}.
      setupFiles: [
        writeSeamModule(
          run,
          setupId,
          setupSource(run.runDirectory, run.caseDirectory, { continuations, story, root }),
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
      // FIXME: a project with its own runner gets file-level answers without
      // being told, and a `snapshotSerializers` or `diff` file of its that
      // imports product source throws at its first probe, because this seam's
      // runner is what installs the probe root before Vitest loads them; the
      // case runner could extend the configured class instead.
      ...(config.test?.runner === undefined
        ? {
          runner: writeSeamModule(run, runnerId, caseRunnerSource({
            module: runnerImport(configRoot, runnerId, '@vitest/runner'),
            utils: runnerImport(configRoot, runnerId, '@vitest/runner/utils'),
            finished: run.finishedDirectory,
            recording: { continuations, story: story !== undefined },
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

function selectionPlugin(
  root: string,
  setupId: string,
  runnerId: string,
  globalSetup: ReadonlySet<string>,
  run: SelectionRun,
  include: (file: string) => boolean,
  mode: InstrumentMode,
  declared: readonly string[],
  settle: (files: readonly FinishedFile[]) => Promise<void>,
): VitePlugin {
  const { modules } = run;
  let closing: Promise<void> | undefined;
  return {
    name: 'variance-authority:test-selection',
    enforce: 'post',
    // A command-line `--reporter` replaces the configured reporters rather
    // than adding to them, and an editor that runs a test from the gutter
    // passes its own. Vitest 2 has no hook that could put this seam's back.
    // The server closes when the run does, in every major, so the run is
    // folded here from what the case runner wrote, if no reporter folded it.
    // Once, because a server with two environments closes each of them.
    closeBundle() {
      return closing ??= closeRun(run, settle, [setupId, runnerId]);
    },
    // Where a file runs is the runner's to say, and `--browser` says it after
    // the configuration was written, so it is read here, where the command line
    // has already been merged in. A file in a page has no disk, no builtins and
    // no runner of this seam's: its setup module hands the runner what it ran.
    // TODO: record cases in a page — a drain per test in `beforeEach` and
    // `afterEach`, carried on each test's `meta` as the file's is.
    config(config) {
      if (config.test?.browser?.enabled !== true) return;
      // FIXME: a `snapshotSerializers` or `diff` file that imports product
      // source throws at its first probe in a page. `@vitest/browser` 3.2.7 and
      // 4.1.2 load them in `initiateRunner`, before `startTests` runs the first
      // file's setup files, and the setup module written here is what installs
      // the page's root. A module that installs it, imported ahead of them,
      // would carry what they load to the file the way the case runner does.
      writeSeamModule(run, setupId, browserSetupSource(mode));
      if (config.test.runner === runnerId) delete config.test.runner;
      // An index with no case in it answers *which cases walk this line* with
      // none, so a run that recorded no case writes no index.
      if (run.cases) {
        run.cases = false;
        console.warn(
          'variance-authority: a test file that runs in a page is recorded per file, not per case; ' +
            'this run writes the file-level snapshot only.',
        );
      }
    },
    configResolved: declareConfig(run, declared, [setupId, runnerId]),
    // A file changed on disk, so its reading describes text the disk no longer
    // holds, and a rerun transforms it again only if a test still loads it.
    // So does every reading named after it: a build's regions sit on the lines
    // the file had when the build was made, and a rerun would join them to the
    // file's new ones. Nothing else goes: Vite serves an unchanged file from
    // its cache, and a reading of it is the text that runs.
    watchChange(id) {
      const changed = projectPath(root, cleanId(id));
      for (const [moduleId, module] of modules) {
        if (moduleId === changed || module.file === changed) modules.delete(moduleId);
      }
    },
    transform(code, id) {
      // The setup module installs the probe log; instrumented, its own header
      // would ask for the log's root before the module has installed it.
      // The runner module is this seam's too, and both sit under the root the
      // default include reaches. Compared after the query suffix is stripped,
      // because the runner is a file on disk now and a real file is the kind of
      // id a bundler decorates. A `globalSetup` file is the file Vitest runs,
      // so it is refused by the name it was loaded under, whatever its map says.
      const file = cleanId(id);
      if (file === setupId || file === runnerId || globalSetup.has(file)) return null;
      // The digest is of the text on disk, which is what the block lines are
      // coordinates in once the prior transforms' maps are read back through —
      // and of `code`, which is what those transforms made of it, when there is
      // no map to read back through and the lines stay where they were left.
      // The include is asked about the file the frame names, so a build is
      // product source by its source.
      const frame = includedFrame(
        code,
        () => priorMap(this),
        file,
        include,
        (at) => readFileSync(at, 'utf8'),
      );
      if (frame === undefined) return null;
      const { extentOf, sourceDigest, file: wrote } = frame;

      // Named after the file its map leads to, the same name every other seam
      // instruments under, so a journal reads the same whoever produced it. Its
      // probes report under the file the transform was handed: a source and its
      // build both answer to the name, each with its own regions, and the fold
      // joins them (see `joinReadings`). Vitest re-transforms every run in this
      // process, so the records stay in this map rather than going to the store
      // a build needs — writing two hundred thousand files to read them back a
      // second later is ceremony, not durability.
      const name = projectPath(root, wrote);
      const moduleId = projectPath(root, file);
      const done = instrument(code, name, moduleId, { mode });
      modules.set(moduleId, done === undefined
        ? { file: name, id: moduleId, sourceDigest, instrumented: false, blocks: [] }
        : {
            file: name,
            id: moduleId,
            sourceDigest,
            instrumented: true,
            blocks: done.blocks.map((block) => coverageBlock(code, block, extentOf)),
          });
      return done === undefined ? null : { code: done.code, map: null };
    },
  };
}

/**
 * Fold a run no reporter folded, from the trees its workers wrote, and take
 * the shims off, with the directory the run made for them once they leave it
 * empty: a watching run kept them for its reruns, and this is its last.
 *
 * A run whose runner is the project's own left journals and no tree, and a
 * journal alone cannot say whether its file passed: it is said, and nothing is
 * written, rather than a record that calls every file complete.
 */
async function closeRun(
  run: SelectionRun,
  settle: (files: readonly FinishedFile[]) => Promise<void>,
  shims: readonly string[],
): Promise<void> {
  try {
    await foldUnfolded(run, settle);
  } finally {
    removeSeamModules(run, shims);
  }
}

async function foldUnfolded(
  run: SelectionRun,
  settle: (files: readonly FinishedFile[]) => Promise<void>,
): Promise<void> {
  if (run.settled) return;
  const files = await readFinished(run.finishedDirectory);
  if (files.length > 0) return settle(files);
  if (!existsSync(run.runDirectory)) return;
  run.settled = true;
  console.warn(
    'variance-authority: this run recorded nothing. A command-line `--reporter` replaced the ' +
      'reporter that writes the record, and the configured `runner` is the project\'s own, so no ' +
      'worker reported which files passed. Run without `--reporter` to record.',
  );
  rmSync(run.runDirectory, { recursive: true, force: true });
  rmSync(run.caseDirectory, { recursive: true, force: true });
}

function selectionReporter(
  run: SelectionRun,
  settle: (files: readonly FinishedFile[]) => Promise<void>,
): Reporter {
  // Vitest 2 announces the end of a run as `onFinished(files)`, where a file is
  // a runner task. Vitest 3 replaced that with `onTestRunEnd(testModules)` over
  // a reported-task API, and Vitest 4 stopped calling `onFinished` on reporters
  // altogether — silently, because a reporter with no hook a runner recognises
  // is a reporter that never objects. A suite would go green and write no
  // snapshot. Both hooks are declared, both narrow to the same two facts, and
  // whichever the runner calls first is the one that counts.
  //
  // Each file also carries the configuration it ran under, as the runner
  // resolved it: Vitest 3 and 4 hand the project over, and Vitest 2 hands its
  // name, which `onInit` has already mapped to the project.
  let byName = new Map<string, string>();
  // Held, not copied: a name filter and a cancel are both set on the runner
  // after `onInit`, and each run's end asks it afresh.
  let runner: RunnerContext | undefined;
  const configsOf = (config: string | undefined) => (config === undefined ? {} : { configs: [config] });
  // A rerun starts as `onWatcherRerun` in every major and as `onTestRunStart`
  // from Vitest 3, both after the last run's end was awaited: the fold reopens
  // there, and the rerun's end folds the files the rerun ran.
  return {
    onInit: (context: RunnerContext) => {
      runner = context;
      byName = noteRunner(run, context);
      run.watching = context.config?.watch === true;
    },
    onWatcherRerun: () => reopenRun(run),
    onTestRunStart: () => reopenRun(run),
    onFinished: (files: readonly RunnerTask[]) => settle(
      files.flatMap((file) => file.filepath === undefined
        ? []
        : [{
          filepath: file.filepath,
          complete: taskComplete(file, runnerSkipped(runner)),
          ...reportedDuration(file.result?.duration),
          ...taskCases(file),
          ...carriedJournal(file.filepath, file.meta),
          ...configsOf(byName.get(file.projectName ?? '')),
        }]),
    ),
    onTestRunEnd: (reported: readonly ReportedModule[], _errors?: unknown, reason?: string) => settle(
      reported.map((module) => ({
        filepath: module.moduleId,
        complete: reportedComplete(module, runnerSkipped(runner, reason)),
        ...reportedDuration(module.diagnostic?.()?.duration),
        ...reportedCases(module),
        ...carriedJournal(module.moduleId, module.meta?.()),
        ...configsOf(projectConfig(module.project)),
      })),
    ),
  } as Reporter;
}

function array<T>(value: T | readonly T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? [...value] : [value as T];
}

export { mergeCoverage } from './merge.js';
