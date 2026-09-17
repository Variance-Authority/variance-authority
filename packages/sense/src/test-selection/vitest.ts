import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
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
  readonly resolveId: (id: string) => string | null;
  readonly load: (id: string) => string | null;
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
  const setupId = resolve(root, '.variance-authority/test-selection-setup.js');
  const runnerId = resolve(root, '.variance-authority/test-selection-case-runner.js');
  const include = options.include ?? defaultInclude;
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

  const plugin = selectionPlugin(
    root,
    run.runDirectory,
    run.caseDirectory,
    setupId,
    runnerId,
    run.modules,
    include,
    run.names,
    mode,
    options.cases === true,
  );
  return {
    ...config,
    plugins: [...array(config.plugins), plugin],
    test: {
      ...config.test,
      // First, so a setup file of the project's that loads an instrumented
      // module finds the counter factory its header resolves.
      setupFiles: [setupId, ...setupFiles],
      // Kept for a single-configuration project, where this config is the root
      // one as well and its reporters are the ones that run.
      reporters: [...reporters, reporter],
      // A runner of the project's own is left alone rather than replaced: a case
      // scope is worth less than a suite that runs. Per-case recording then has
      // no bracket and records the file as one ambient bucket, which is the
      // file-level answer it already had.
      ...(options.cases === true && config.test?.runner === undefined
        ? { runner: runnerId }
        : {}),
    },
  };
}

function selectionPlugin(
  root: string,
  runDirectory: string,
  caseDirectory: string,
  setupId: string,
  runnerId: string,
  modules: Map<ModuleId, CapturedModule>,
  include: (file: string) => boolean,
  names: ModuleNames,
  mode: InstrumentMode,
  cases: boolean,
): VitePlugin {
  return {
    name: 'variance-authority:test-selection',
    enforce: 'post',
    // The setup module keeps its path as its id rather than taking a virtual
    // one. Vitest drops every setup file from the module cache by path before
    // each test file so setup runs again without isolation; a module cached
    // under another id would survive that and run once for the whole worker.
    resolveId: (id) => (id === setupId || id === runnerId ? id : null),
    load: (id) =>
      id === setupId
        ? setupSource(runDirectory, cases ? caseDirectory : undefined)
        : id === runnerId
          ? caseRunnerSource()
          : null,
    transform(code, id) {
      // The setup module installs the counter factory; instrumented, its own
      // header would ask for the factory before the module has installed it.
      // The runner module is this seam's too, and both sit under the root the
      // default include reaches.
      if (id === setupId || id === runnerId) return null;
      const file = cleanId(id);
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
  const settle = async (files: readonly FinishedFile[]): Promise<void> => {
    if (run.settled) return;
    run.settled = true;
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
