import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import type { Reporter } from 'vitest/reporters';
import type { UserConfig } from 'vitest/config';
import { instrument, instrumentationId, type InstrumentMode, type ModuleId } from '../instrument/index.js';
import { nameModules, readModuleNames, type ModuleNames } from '../module-names.js';
import { priorMap, type TransformingContext } from './probes.js';
import { commitOf } from './commit.js';
import { layeredCoverage } from './format-layer.js';
import {
  cleanId,
  codeUnitOrder,
  coverageBlock,
  coverageModule,
  crossingsOf,
  defaultInclude,
  loadedOf,
  moduleNamesFile,
  openModuleNames,
  projectPath,
  type CapturedModule,
} from './instrumented-modules.js';
import { recordedFrame } from './source-lines.js';
import { executionIndexFrom, readCaseJournals } from './cases.js';
import {
  coverageTest,
  noteAnEmptyRecord,
  readJournals,
  reportedComplete,
  taskComplete,
  type FinishedFile,
  type ReportedModule,
  type RunnerTask,
} from './finished-files.js';
import { noteABusyIndex, withIndexLock } from './index-lock.js';
import { caseRunnerSource, setupSource } from './worker-source.js';
import {
  seedTestCoverage,
  testCoverageFile,
  writeCoverageBytes,
  type CoverageModule,
  type TestCoverage,
} from './index.js';

export interface TestSelectionOptions {
  /** Repository root. Defaults to the Vitest config root, then the current directory. */
  readonly root?: string;
  /** Persisted coverage index. Defaults to the repository-keyed user cache. */
  readonly coverageFile?: string;
  /** Decide which transformed modules are product source. */
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
   * The snapshot CI reads is unchanged either way — this adds a second artifact
   * beside it, and never alters the first.
   */
  readonly cases?: boolean;
  /** Where the per-case execution index goes. Defaults to `<coverageFile>.cases.json`. */
  readonly executionFile?: string;
}

interface VitePlugin {
  readonly name: string;
  readonly enforce: 'post';
  readonly transform: (
    this: TransformingContext,
    code: string,
    id: string,
  ) => { code: string; map: null } | null;
}

/**
 * One recording, shared by every configuration that takes part in it.
 *
 * A Vitest run with `projects` is several configuration files, each evaluated
 * as its own module, and the two halves of this seam do not land in the same
 * one: transforms belong to a project, while reporters are a root-only option
 * that a project config may declare and the runner will ignore. So the halves
 * have to find each other, and a module-level variable cannot do it.
 *
 * Keyed by the snapshot being written, on the process, because that is exactly
 * the scope the run has: one Vitest process, one coverage file, however many
 * configuration modules were evaluated to describe it.
 */
interface SelectionRun {
  readonly root: string;
  readonly runDirectory: string;
  /** Beside the run directory rather than inside it: the fold there reads every name it finds. */
  readonly caseDirectory: string;
  readonly modules: Map<ModuleId, CapturedModule>;
  /** Union over the projects: every file whose text every observation depended on. */
  readonly preconditions: Set<string>;
  readonly names: ModuleNames;
  readonly mode: InstrumentMode;
  /** Whether any configuration in this run asked for per-case crossings. */
  cases: boolean;
  /** The snapshot is written once, by whichever hook the runner calls. */
  settled: boolean;
}

const RUNS = Symbol.for('variance-authority.test-selection.runs');

function runFor(coverageFile: string, root: string, mode: InstrumentMode): SelectionRun {
  const carrier = globalThis as { [RUNS]?: Map<string, SelectionRun> };
  const runs = (carrier[RUNS] ??= new Map<string, SelectionRun>());
  const found = runs.get(coverageFile);
  if (found !== undefined) return found;
  const runDirectory = resolve(dirname(coverageFile), `.run-${process.pid}-${randomUUID()}`);
  const run: SelectionRun = {
    root,
    runDirectory,
    caseDirectory: `${runDirectory}-cases`,
    modules: new Map<ModuleId, CapturedModule>(),
    preconditions: new Set<string>(),
    // Once per process, before any module is transformed: the table this run
    // reads is the one the last fold published, and this run's own fold grows it.
    names: readModuleNames(openModuleNames(root)),
    mode,
    cases: false,
    settled: false,
  };
  runs.set(coverageFile, run);
  return run;
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
  const root = resolve(options.root ?? config.root ?? process.cwd());
  const coverageFile = options.coverageFile === undefined
    ? testCoverageFile(root)
    : resolve(root, options.coverageFile);
  const mode = options.mode ?? 'presence';
  const run = runFor(coverageFile, root, mode);
  if (options.cases === true) run.cases = true;
  // Named for the run rather than for the seam. These are files on disk now, so
  // two Vitest processes over one project — a watch run beside a CLI one, or
  // this repository's own integration tests — would otherwise write each other's
  // setup shim, and a shim carries the directory its journals go to. The run
  // directory already carries a pid and a uuid; the same stamp names the shim.
  const stamp = basename(run.runDirectory).replace(/^\.run-/, '');
  const setupId = resolve(root, `.variance-authority/test-selection-setup-${stamp}.mjs`);
  const runnerId = resolve(root, `.variance-authority/test-selection-case-runner-${stamp}.mjs`);
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
      .map((file) => resolve(root, file)),
  );
  const chosen = options.include ?? defaultInclude;
  const include = (file: string): boolean => !globalSetup.has(file) && chosen(file);
  const setupFiles = array(config.test?.setupFiles);
  // A setup entry may be a package — `dotenv/config` — rather than a file of
  // the project's; a package is no precondition a diff can carry, and read as a
  // path it is a missing file that fails the reporter and loses the snapshot.
  for (const file of [
    ...setupFiles.filter((file): file is string => typeof file === 'string' && existsSync(resolve(root, file))),
    ...(options.preconditions ?? []),
  ]) run.preconditions.add(resolve(root, file));

  const executionFile = options.executionFile === undefined
    ? `${coverageFile}.cases.json`
    : resolve(root, options.executionFile);
  const reporter = selectionReporter(coverageFile, executionFile, run);
  const reporters = config.test?.reporters === undefined ? ['default'] : array(config.test.reporters);

  // A configuration that names projects describes the run rather than a suite:
  // nothing is transformed under it, and it is the only place a reporter is
  // read from. Adding the plugin and the setup file here would put them on a
  // config that loads no test file.
  // `projects` is Vitest 3 and 4's name for it; Vitest 2 called the same idea
  // `workspace`. Read structurally, because the seam is built against one of
  // them and run against whichever the project installed.
  const describesProjects = (config.test as { projects?: unknown } | undefined)?.projects !== undefined;
  if (describesProjects) {
    return { ...config, test: { ...config.test, reporters: [...reporters, reporter] } };
  }

  const plugin = selectionPlugin(root, setupId, runnerId, run.modules, include, run.names, mode);
  return {
    ...config,
    plugins: [...array(config.plugins), plugin],
    test: {
      ...config.test,
      // First, so a setup file of the project's that loads an instrumented
      // module finds the counter factory its header resolves. On disk rather
      // than virtual — see {@link writeSeamModule}.
      setupFiles: [
        writeSeamModule(setupId, setupSource(run.runDirectory, options.cases === true ? run.caseDirectory : undefined)),
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
        ? { runner: writeSeamModule(runnerId, caseRunnerSource()) }
        : {}),
    },
  };
}

/**
 * Put one of this seam's own modules on disk, and answer with its path.
 *
 * The setup module and the case runner used to be virtual ids this plugin
 * resolved and loaded. Vitest 4 loads both through Vite's module runner, which
 * resolves them before any plugin of the test config is consulted: the ids come
 * back `ERR_MODULE_NOT_FOUND`, and the shape of the failure is the reason this
 * is a file now rather than a special case. The runner one reports *no tests*
 * and still writes an execution index — green, and empty. A real absolute path
 * needs no plugin on any major.
 *
 * Written every time rather than when absent: the source is this package's, so
 * a version bump has to land, and a stale file here would be another release's
 * shim wrapping this one's run. `.mjs`, because the project it lands in may not
 * declare `"type": "module"`.
 */
function writeSeamModule(id: string, source: string): string {
  mkdirSync(dirname(id), { recursive: true });
  writeFileSync(id, source, 'utf8');
  return id;
}

function selectionPlugin(
  root: string,
  setupId: string,
  runnerId: string,
  modules: Map<ModuleId, CapturedModule>,
  include: (file: string) => boolean,
  names: ModuleNames,
  mode: InstrumentMode,
): VitePlugin {
  return {
    name: 'variance-authority:test-selection',
    enforce: 'post',
    transform(code, id) {
      // The setup module installs the counter factory; instrumented, its own
      // header would ask for the factory before the module has installed it.
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
      const { lineOf, sourceDigest } = recordedFrame(code, priorMap(this), file, () =>
        readFileSync(file, 'utf8'),
      );

      // Under its id, the same one every other seam instruments under, so a
      // journal reads the same whoever produced it. Vitest re-transforms every
      // run in this process, so the records stay in this map rather than going
      // to the store a build needs — writing two hundred thousand files to read
      // them back a second later is ceremony, not durability.
      const name = projectPath(root, file);
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
): Reporter {
  const { root, runDirectory, caseDirectory, modules, mode } = run;
  // Vitest 2 announces the end of a run as `onFinished(files)`, where a file is
  // a runner task. Vitest 3 replaced that with `onTestRunEnd(testModules)` over
  // a reported-task API, and Vitest 4 stopped calling `onFinished` on reporters
  // altogether — silently, because a reporter with no hook a runner recognises
  // is a reporter that never objects. A suite would go green and write no
  // snapshot. Both hooks are declared, both narrow to the same two facts, and
  // whichever the runner calls first is the one that counts.
  // The shims this run wrote, named after this run. Nothing else reads them
  // once the journals are folded, and leaving them would grow a directory in
  // the user's project by two files a run — including after a run that refuses,
  // which is why they come off in a `finally` rather than at the happy end.
  const stamp = basename(runDirectory).replace(/^\.run-/, '');
  const dropShims = async (): Promise<void> => {
    await rm(resolve(root, `.variance-authority/test-selection-setup-${stamp}.mjs`), { force: true });
    await rm(resolve(root, `.variance-authority/test-selection-case-runner-${stamp}.mjs`), { force: true });
  };

  const settle = async (files: readonly FinishedFile[]): Promise<void> => {
    if (run.settled) return;
    run.settled = true;
    try {
      await record(files);
    } finally {
      await dropShims();
    }
  };

  const record = async (files: readonly FinishedFile[]): Promise<void> => {
    noteAnEmptyRecord(files.length, modules.size);
    const journals = await readJournals(runDirectory);
    // A journal names modules by id, so nothing here re-keys paths; the id is
    // what the map is keyed by too.
    const rows = journals.map((journal) => ({
      testFile: projectPath(root, journal.testFile),
      modules: journal.modules,
    }));
    const observed = crossingsOf(rows);
    const early = loadedOf(rows);

    const tests = await Promise.all(
      files.map((file) => coverageTest(file, root, [...run.preconditions], journals, modules)),
    );
    const commit = await commitOf(root);
    const current: TestCoverage = {
      version: 3,
      instrumentation: instrumentationId(mode),
      ...(commit === undefined ? {} : { commit }),
      tests: tests.sort((left, right) => codeUnitOrder(left.file, right.file)),
      modules: [...modules]
        .map(([id, module]): CoverageModule => coverageModule(
          module,
          (block) => [...(observed.get(id)?.get(block.ordinal) ?? [])],
          (block) => [...(early.get(id)?.get(block.ordinal) ?? [])],
        ))
        .sort((left, right) => codeUnitOrder(left.file, right.file)),
    };
    // The repository's snapshot becomes this checkout's before the first run
    // lands on it, so a worktree layers onto months of recording rather than
    // onto nothing. A no-op in the primary checkout and after the first run.
    await seedTestCoverage(coverageFile, root);
    // Both writes are read-modify-write over one index and both happen under one
    // lock, because a merge that landed while the numbering was still deciding
    // would describe modules the table had not agreed on yet.
    const merged = await withIndexLock(coverageFile, async (lock) => {
      await writeCoverageBytes(coverageFile, await layeredCoverage(coverageFile, current, root));
      // Everything this run saw, numbered for the next one. A file first met
      // today was instrumented under its path; from here on it has a number.
      await nameModules(
        moduleNamesFile(root),
        [...modules.values()].map((module) => module.file),
        lock,
      );
    });
    if (!merged.held) noteABusyIndex(coverageFile);
    // Beside the snapshot, never inside it. The snapshot answers *which files
    // must run*, its readers are unchanged, and a run that records cases writes
    // the same bytes there as one that does not.
    if (run.cases) {
      const journals = await readCaseJournals(caseDirectory, root);
      await writeFile(
        executionFile,
        JSON.stringify(executionIndexFrom(journals, modules)),
      );
    }
    await rm(runDirectory, { recursive: true, force: true });
    await rm(caseDirectory, { recursive: true, force: true });
  };

  return {
    onFinished: (files: readonly RunnerTask[]) => settle(
      files.flatMap((file) => file.filepath === undefined
        ? []
        : [{ filepath: file.filepath, complete: taskComplete(file) }]),
    ),
    onTestRunEnd: (reported: readonly ReportedModule[]) => settle(
      reported.map((module) => ({ filepath: module.moduleId, complete: reportedComplete(module) })),
    ),
  } as Reporter;
}

function array<T>(value: T | readonly T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? [...value] : [value as T];
}

export { mergeCoverage } from './merge.js';
