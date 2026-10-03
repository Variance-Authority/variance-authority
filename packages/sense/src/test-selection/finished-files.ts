/**
 * What a finished test file is worth as evidence.
 *
 * The reporter is handed a list of files the run is done with and has to decide,
 * per file, whether the record it left can be used to *exclude* that file from a
 * later run. That decision is the whole of the seam's risk: a file wrongly called
 * complete is a file a change can silently skip. So it is made here, away from
 * the plumbing that produced the record, with the argument for each outcome
 * written beside the outcome.
 *
 * Two runner shapes reach it. Vitest 2 announces a tree of tasks; Vitest 3 and 4
 * announce reported modules. Both are read structurally rather than by importing
 * the runner's own types, because the seam is built against one version and run
 * against whichever the project installed.
 */

import { readFile } from 'node:fs/promises';
import { digestString } from '../digest.js';
import type { ModuleId } from '../instrument/index.js';
import journalFormat from './journal-format.cjs';
import {
  projectPath,
  readWritten,
  type CapturedModule,
  type ReadJournal,
} from './instrumented-modules.js';
import type { CoveragePrecondition, CoverageTest } from './index.js';
import type { ExecutedModule } from './probes.js';
import { BROWSER_JOURNAL } from './worker-source.js';
import type { RunnerContext, RunnerProject } from './governing-config.js';
import { taskCases, type FinishedCase } from './case-durations.js';

export interface RunnerTask {
  readonly filepath?: string;
  /** The task's own name, and the runner's id for it, which the case runner carries. */
  readonly name?: string;
  readonly id?: string;
  /** How the runner meant to treat the task: `run`, or `skip` and `todo` for one it never starts. */
  readonly mode?: string;
  /** `duration` is the milliseconds the runner measured for the task, when it did. */
  readonly result?: { readonly state: string; readonly duration?: number };
  readonly tasks?: readonly RunnerTask[];
  readonly meta?: object;
  /** Vitest 2's name for the project that ran the file. */
  readonly projectName?: string;
}

/**
 * Vitest 3 and 4's reported test module, structurally: a type from the runner's
 * own package would pin the build to a version the project need not have.
 */
export interface ReportedModule {
  readonly moduleId: string;
  readonly children: {
    allTests: () => Iterable<{
      result: () => { readonly state: string };
      readonly id?: string;
      readonly fullName?: string;
      diagnostic?: () => { readonly duration?: number } | undefined;
    }>;
    /** Vitest 3 and 4 only; a suite holds the errors its own hooks threw. */
    allSuites?: () => Iterable<{ errors?: () => { readonly length: number } }>;
  };
  /** False when the module, or anything in it, did not finish. */
  readonly ok?: () => boolean;
  /** What the module itself failed on, a thrown file-level hook included. */
  readonly errors?: () => { readonly length: number };
  /** What the file's own hooks attached to it, carried from wherever it ran. */
  readonly meta?: () => object;
  /** The project that ran it, whose Vite server loaded its configuration. */
  readonly project?: RunnerProject;
  /** Vitest 3 and 4: `duration` is every test and hook in the module, as the runner timed them. */
  readonly diagnostic?: () => { readonly duration?: number } | undefined;
}

/**
 * The one outcome that looks like a clean run and is not one.
 *
 * A run that transformed no product module records no coverage: `landRun`
 * lands its cases and leaves the coverage the record held as it was, so the
 * run narrows no later selection. Nothing else in this seam fails, and a run
 * that was meant to measure and did not is otherwise silent.
 *
 * Said rather than thrown, because zero is legitimate: a run filtered down to
 * one test file that imports no source has nothing to instrument. The two
 * misconfigurations it usually is are named in the message, because a reader
 * looking at "0 modules" has no way to guess which. Zero test files is left
 * alone: a run that collected nothing has already said so.
 */
export function noteAnEmptyRecord(
  testFiles: number,
  instrumented: number,
  unreached = 'Check `include`, and with `projects`, that the plugin and the setup file are ' +
    'inside each project rather than beside them: a project inherits neither.',
): void {
  if (instrumented > 0 || testFiles === 0) return;
  console.warn(
    `variance-authority instrumented 0 modules across ${testFiles} test file(s); ` +
      `this run recorded no coverage, so it narrows no later selection. ${unreached}`,
  );
}

/** A test file the run finished with, whichever runner announced it. */
export interface FinishedFile {
  readonly filepath: string;
  /** Every test in it ran and passed, so its record is the whole file's reach. */
  readonly complete: boolean;
  /**
   * What the file ran, when the runner carried it here rather than a worker
   * writing it down: a page has no disk to write a frame to.
   */
  readonly journal?: ReadJournal;
  /**
   * The configurations it ran under, when the runner said: a file two projects
   * both match ran under both. Absent when the runner did not say.
   */
  readonly configs?: readonly string[];
  /** Milliseconds the runner reported for the file; absent when it reported none. */
  readonly duration?: number;
  /** Every case the runner reported in it; absent when it reported none. */
  readonly cases?: readonly FinishedCase[];
}

/** The runner's duration for a file, as a field to spread; nothing here times a file. */
export function reportedDuration(value: unknown): Pick<FinishedFile, 'duration'> {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? { duration: value } : {};
}

/** What a page's two drains carry: before the first test, and after it. */
interface PageDrains {
  readonly loaded: readonly ExecutedModule[];
  readonly ran: readonly ExecutedModule[];
}

/**
 * The journal a page carried on its file's `meta`, as the fold reads a frame.
 *
 * The page drains twice, so a module is in either drain or both; the file
 * entered the union, and had entered the first drain before its first test.
 * Absent when the file carried nothing — its `afterAll` never ran, or it ran
 * somewhere other than a page — which {@link coverageTest} reads as a file
 * that left no journal.
 */
export function carriedJournal(testFile: string, meta: object | undefined): Pick<FinishedFile, 'journal'> {
  const carried = (meta as Record<string, unknown> | undefined)?.[BROWSER_JOURNAL];
  if (typeof carried !== 'object' || carried === null) return {};
  const { loaded, ran } = carried as Partial<PageDrains>;
  if (!Array.isArray(loaded) || !Array.isArray(ran)) return {};
  const modules = new Map<ModuleId, { hits: Set<number>; shared: Set<number>; loaded: readonly number[] }>();
  for (const [drain, early] of [[loaded, true], [ran, false]] as const) {
    for (const module of drain) {
      const row = modules.get(module.id) ?? { hits: new Set(), shared: new Set(), loaded: [] };
      for (const ordinal of module.hits) row.hits.add(ordinal);
      for (const ordinal of module.shared) row.shared.add(ordinal);
      modules.set(module.id, early ? { ...row, loaded: module.hits } : row);
    }
  }
  const ascending = (ordinals: Iterable<number>): number[] => [...ordinals].sort((a, b) => a - b);
  return {
    journal: {
      testFile,
      modules: [...modules].map(([id, row]) => ({
        id,
        hits: ascending(row.hits),
        shared: ascending(row.shared),
        loaded: ascending(row.loaded),
      })),
    },
  };
}

/**
 * Whether a test's outcome leaves the file's record usable as evidence.
 *
 * A pass is the plain case: the test ran to the end, so everything it reaches is
 * in the record and absence from the record is absence from its reach.
 *
 * A *skip* is the case worth arguing, because the conservative reading — anything
 * that is not a pass spoils the file — is what a suite like Material UI's runs
 * into: it skips several hundred tests by design, which leaves five sixths of its
 * files unable to justify excluding anything, and a selector that cannot exclude
 * is a selector nobody runs. The argument for counting it: a skipped test does
 * not execute, so it cannot fail, so leaving it out of a run costs nothing. The
 * only way it starts costing something is if a later run stops skipping it, and
 * every way that happens is already covered — `it.skip` in the test file is the
 * test file's own text, which is a digest-checked precondition of the record, and
 * a condition computed from something the file imports was evaluated during
 * collection, so those modules are in the record and a change to them selects the
 * file. What is not covered is a skip decided outside the source entirely, by an
 * environment variable or a platform check; that is the same boundary every
 * diff-based selector has, and it is the configuration's job, not the diff's.
 *
 * A failure is not counted, and neither is an error: a test that stopped early
 * recorded only as far as it got, so its file undercounts its own reach and the
 * undercount is invisible.
 *
 * A file where *every* test is skipped is the one case this cannot decide on its
 * own: the runner skips the file's hooks too, so nothing writes its journal.
 * `coverageTest` refuses the file for that reason instead.
 *
 * And a skip the *runner* wrote is not a skip at all, which is why the outcome
 * of one test is never the whole answer — see {@link stopped} and
 * {@link runnerSkipped}.
 */
const usableOutcome = (state: string): boolean =>
  state === 'pass' || state === 'passed' || state === 'skip' || state === 'skipped' || state === 'todo';

/**
 * Whether a suite stopped part-way, which is how a thrown fixture reads.
 *
 * A `beforeAll` that throws does not fail the tests it guards — the runner
 * rewrites every one of them to *skipped*, mode and all, and fails the suite
 * that held the hook. Read leaf by leaf, that file is a file of passes and
 * skips, which is the shape of a file that ran everything it meant to. It is
 * the opposite: those tests never executed a line, and the regions only they
 * enter are now recorded as reached by nobody.
 *
 * That matters more than an ordinary incomplete record because nothing takes it
 * back. The file is still marked whole, so a change to one of the regions it
 * lost leaves it in the skip list; being skipped, it never runs again to record
 * what it reaches; and the fixture that failed is usually not in the file's own
 * text, so no digest moves and no precondition retires the claim. A snapshot
 * that already held the crossing loses it too, since a whole record replaces
 * what it supersedes. One flaky database is enough to amputate a file's reach
 * for good.
 *
 * So the suite's own outcome is read alongside its tests'. A skip the file's
 * text asked for leaves every suite passing and is counted exactly as before; a
 * skip the runner injected leaves a suite failed, and that file's record is
 * worth what a failed run's record is worth — evidence of what ran, and no
 * licence to exclude anything.
 */
const stopped = (task: RunnerTask): boolean =>
  task.tasks !== undefined
  && task.tasks.length > 0
  && (task.result?.state === 'fail' || task.tasks.some(stopped));

/**
 * A test's outcome as the runner itself reads one it never started.
 *
 * Vitest 2 returns from a test whose mode is not `run` before it writes any
 * result: an `it.todo`, an `it.skip`, everything under a closed `describe.skip`
 * gate. The tree it hands over holds that test's mode and no state, so the mode
 * is the only outcome the runner has, and it is carried rather than read as a
 * test that went missing. Vitest 3 and 4 answer the same absence the same way —
 * their reported test is `skipped` when it has no result and its mode is `skip`
 * or `todo` — which is what {@link reportedComplete} is handed. A test the run
 * meant to run and left with no result still has no usable outcome: its mode is
 * `run`.
 *
 * The file's text is not the only thing that writes that mode. A name filter
 * rewrites every test it leaves out to `skip` at collection, and a cancelled
 * run rewrites every test it had not reached, in the worker's copy of the tree.
 * Neither is the skip {@link usableOutcome} argues for, and the mode does not
 * say which wrote it, so in a run where either may have happened — see
 * {@link runnerSkipped} — a `skip` with no result is not an outcome. A `todo`
 * still is: neither rewrite writes one.
 */
const outcome = (task: RunnerTask, runnerSkipped: boolean): string =>
  task.result?.state
    ?? (task.mode === 'todo' || (task.mode === 'skip' && !runnerSkipped) ? task.mode : 'missing');

/**
 * @param runnerSkipped Whether the runner may have skipped a test the file did
 * not ask it to, as {@link runnerSkipped} reads the run.
 */
export function taskComplete(file: RunnerTask, runnerSkipped: boolean): boolean {
  const leaves = (task: RunnerTask): readonly RunnerTask[] =>
    task.tasks === undefined || task.tasks.length === 0 ? [task] : task.tasks.flatMap(leaves);
  const tests = leaves(file);
  return !stopped(file)
    && tests.length > 0
    && tests.every((task) => usableOutcome(outcome(task, runnerSkipped)));
}

/**
 * Whether the runner may have skipped tests on its own in this run, as the
 * runner's own state says.
 *
 * A skip is counted because the file's text asked for it — see
 * {@link usableOutcome}. Two things skip a test without the file asking. A name
 * filter — `-t`, watch mode's `t`, an editor running one test from its gutter —
 * leaves the rest of the file out. Recorded whole, that file's reach shrinks to
 * what the chosen tests reached: a whole record replaces the crossings the file
 * recorded before, so a later change to a region only the left-out tests enter
 * no longer selects the file, and nothing runs it to put the crossing back. A
 * cancelled run — `--bail`, an interrupted watch run — does the same to every
 * test it had not reached.
 *
 * Read off the runner rather than off the tests, because a test does not say
 * which wrote its skip. The filter is `configOverride`'s, which holds both the
 * command line's pattern and the one watch mode sets; the configuration's is
 * asked as well, for a runner that keeps no override. The cancel is
 * `isCancelling` on Vitest 2, which stays set until the next run starts, and the
 * reason Vitest 3 and 4 hand `onTestRunEnd`. A reporter that was handed no
 * context cannot tell, and is answered as a run that may have skipped: refusing
 * costs a file one exclusion, and guessing wrong costs it its reach for good.
 */
export function runnerSkipped(context: RunnerContext | undefined, reason?: string): boolean {
  if (context === undefined) return true;
  const pattern = context.configOverride?.testNamePattern ?? context.config?.testNamePattern;
  return (pattern !== undefined && pattern !== null && pattern !== '')
    || context.isCancelling === true
    || reason === 'interrupted';
}

/**
 * The same reading for a runner that reports a file as one status and its tests
 * as a flat list of them.
 *
 * Rstest is that runner: `onTestRunEnd` hands a result per file whose `results`
 * are its leaves, with no tree between them. The file's own status carries what
 * {@link stopped} reads out of a task tree — a `beforeAll` that throws leaves
 * the file failed and every test in it skipped — so asking it first refuses the
 * thrown-fixture case for the same reason and with the same consequence.
 */
export function statusesComplete(file: string, tests: readonly string[]): boolean {
  return usableOutcome(file) && tests.length > 0 && tests.every(usableOutcome);
}

export function reportedComplete(module: ReportedModule, runnerSkipped: boolean): boolean {
  // The same reading, through the accessors Vitest 3 and 4 put on a reported
  // module: `ok()` is false when anything in it did not finish, and `errors()`
  // — on the module for a file-level hook, on a suite for a nested one — holds
  // what the hook threw. All three are asked for, because a runner that grew
  // the API later than this seam was written may answer only some of them, and
  // each of them alone is enough to refuse.
  if (module.ok?.() === false) return false;
  if ((module.errors?.().length ?? 0) > 0) return false;
  for (const suite of module.children.allSuites?.() ?? []) {
    if ((suite.errors?.().length ?? 0) > 0) return false;
  }
  // A reported test is `skipped` whoever skipped it, and a todo reads the same,
  // so in a run the runner may have cut no skip is counted.
  const usable = (state: string): boolean => (runnerSkipped ? state === 'passed' : usableOutcome(state));
  const tests = [...module.children.allTests()];
  return tests.length > 0 && tests.every((test) => usable(test.result().state));
}

/**
 * One row per test file, however many projects ran it.
 *
 * A runner's projects exist to run the same files under different conditions —
 * zod runs its whole suite a second time with ahead-of-time compilation turned
 * on — and each project announces its own finished file for the same path. The
 * record's unit is a path because the answer's unit is a path: a selector names
 * files to skip, and skipping one skips it in every project that matched it, so
 * what a file reaches is what it reached anywhere. Left as two rows it is not a
 * richer record, it is an unwritable one — the snapshot is keyed by path, and
 * the encode refuses a second row for a key it already holds.
 *
 * `complete` is the conjunction. A file whose compile-mode run failed has an
 * undercounted record whatever its default-mode run did, and one project
 * passing is no licence to exclude the file on the strength of it.
 */
export function oneRowPerFile(
  files: readonly FinishedFile[],
  root: string,
): readonly FinishedFile[] {
  const byPath = new Map<string, FinishedFile>();
  for (const file of files) {
    const path = projectPath(root, file.filepath);
    const seen = byPath.get(path);
    // Unknown under either announcement is unknown for the file: it falls
    // back to every configuration, never to the one that happened to say.
    const configs = seen === undefined
      ? file.configs
      : seen.configs === undefined || file.configs === undefined
      ? undefined
      : [...new Set([...seen.configs, ...file.configs])];
    // The file cost what every project spent on it, and a project that did not
    // say leaves the sum unknown rather than short.
    const duration = seen === undefined
      ? file.duration
      : seen.duration === undefined || file.duration === undefined
      ? undefined
      : seen.duration + file.duration;
    byPath.set(path, {
      filepath: seen?.filepath ?? file.filepath,
      complete: (seen?.complete ?? true) && file.complete,
      ...(configs === undefined ? {} : { configs }),
      ...(duration === undefined ? {} : { duration }),
    });
  }
  return [...byPath.values()];
}

export async function coverageTest(
  task: FinishedFile,
  root: string,
  preconditionFiles: readonly string[],
  journals: readonly ReadJournal[],
  modules: ReadonlyMap<ModuleId, CapturedModule>,
): Promise<CoverageTest> {
  const file = projectPath(root, task.filepath);
  // By name, because the same fact can arrive more than once: a file two
  // projects both ran left a journal under each of them, and the modules those
  // journals name are largely the same modules. A precondition is a name and
  // the digest it was read at, so the second copy adds nothing and costs a row.
  const preconditions = new Map<string, CoveragePrecondition>();
  const require = (precondition: CoveragePrecondition): void => {
    if (!preconditions.has(precondition.name)) preconditions.set(precondition.name, precondition);
  };
  for (const input of [task.filepath, ...preconditionFiles]) {
    require({
      name: projectPath(root, input),
      digest: digestString(await readFile(input, 'utf8')),
    });
  }
  // Whether this file left a journal at all. A file with every test skipped is
  // still collected — its imports run, its top level runs — but a runner skips
  // the file's hooks when it has no test to run, so the `afterAll` that writes
  // the journal never fires. The file is announced as finished all the same, and
  // skipping is a usable outcome, so without this the file is recorded whole
  // with an empty reach: a record that says it entered nothing, which excludes
  // it from every diff there will ever be. Material UI has four such files, and
  // three of them break when a module they import throws at load.
  let recorded = false;
  for (const journal of journals) {
    if (projectPath(root, journal.testFile) !== file) continue;
    recorded = true;
    for (const entered of journal.modules) {
      const module = modules.get(entered.id);
      if (module === undefined) {
        throw new Error(`variance-authority lost the source identity for module ${entered.id}`);
      }
      // Only what the instrument could not see inside. An instrumented module's
      // text is already a digest on its own row, and a change to it is caught by
      // re-cutting its regions — recording it a second time under every test
      // that reached it is the same fact written once per module-test pair. At a
      // repository's scale that is the largest thing in the file: a measured two
      // hundred thousand modules against two thousand test files put a hundred
      // and three million precondition rows and seven hundred and eighty-eight
      // megabytes of columns in front of a snapshot whose regions cost three.
      if (module.instrumented) continue;
      require({ name: module.file, digest: module.sourceDigest });
    }
  }
  return {
    file,
    complete: task.complete && recorded,
    preconditions: [...preconditions.values()],
    ...reportedDuration(task.duration),
  };
}

/**
 * A file as a worker's case runner writes it: its tree, and whether that
 * worker's runner had a name filter or had been cancelled. The worker's answer
 * rather than the reporter's, because the worker's copy of the tree is the one
 * a cancel rewrites.
 */
interface WrittenFile extends RunnerTask {
  readonly filepath: string;
  readonly runnerSkipped?: boolean;
}

/**
 * The files a worker's case runner said it finished, read as the reporter
 * reads the same tree.
 *
 * Empty when no runner of this seam's wrote any: the project brought its own,
 * or no file ran. In the order of what the trees hold, which is the same
 * whichever worker finished first.
 */
export async function readFinished(directory: string): Promise<readonly FinishedFile[]> {
  const trees = (await readWritten(directory)).map((bytes) =>
    JSON.parse(bytes.toString('utf8')) as readonly WrittenFile[]);
  // A tree that does not say is read as one the runner may have cut.
  return trees.flat().map((file) => ({
    filepath: file.filepath,
    complete: taskComplete(file, file.runnerSkipped !== false),
    ...reportedDuration(file.result?.duration),
    ...taskCases(file),
  }));
}

/** The journals a run's workers wrote, in the order of what they hold. */
export async function readJournals(directory: string): Promise<readonly ReadJournal[]> {
  return (await readWritten(directory)).map((bytes) => journalFormat.decodeJournal(bytes));
}
