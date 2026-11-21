/**
 * The process that folds what the workers recorded.
 *
 * Playwright runs specs in worker processes, and the execution index is one
 * file that is merged rather than appended to. The merge retires the previous
 * crossings of every file whose incoming row says it finished, which is right
 * for one process that recorded a file whole and wrong for two that each
 * recorded part of one: the later row wins and the earlier worker's regions
 * leave the index. The spec is then recorded as fully observed with half of
 * what it walked, and the next `--since` skips it over a line that ran. Nothing
 * fails; the run is green and the index quietly wrong, which is the one
 * direction selection may not go.
 *
 * So the workers stage and this folds. Install it beside the recording
 * fixtures, in the same configuration:
 *
 * ```ts
 * export default defineConfig({
 *   reporter: [['list'], ['@variance-authority/playwright-test/reporter']],
 * });
 * ```
 *
 * It is worth installing for a single-worker run too: a worker that finds no
 * staging directory merges for itself and says so, and one that does contribute
 * costs a file write it would have spent on the merge anyway.
 *
 * Under `--shard k/n` it also places the shard, by whole files
 * (`whole-file-shard.ts`), and turns Playwright's own split off. Below
 * Playwright 1.62 nothing calls `preprocess`, so Playwright's split runs:
 * `withTestSelection` refuses such a run when the configuration is evaluated,
 * and a configuration that names this reporter without it is not refused.
 */

import type { FullConfig, FullProject, FullResult, Reporter, Suite, TestCase, TestError, TestResult, TestStep } from '@playwright/test/reporter';
import {
  closeStage,
  foldStage,
  openStage,
  recordChecks,
  recordExecution,
  stagingDirectory,
  type CheckedAttempt,
  type ChecksScope,
  type InstrumentMode,
} from '@variance-authority/sense/journal';
import {
  landingTimes,
  recordFileFor,
  repositoryRoot,
  selectedLines,
} from '@variance-authority/sense/test-selection';
import { fileSelection, keptFiles } from './file-selection.js';
import { commandLineGrep, grepOf } from './run-scope.js';
import { fileOwner, testCaseOf } from './test-coordinate.js';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { placeWholeFiles, type Preprocess } from './whole-file-shard.js';
import { codeUnitOrder } from '@variance-authority/core/segment';

/** The annotation a case declares a check by; its description is the check's id, and the case enters it as a step of that title. */
const CHECK = 'variance:check';

/** A collected case that declares checks, and what each of its attempts entered. */
interface Checked {
  readonly file: string;
  readonly line: number;
  readonly name: string;
  readonly project?: string;
  readonly declared: readonly string[];
  readonly attempts: Map<number, { ended?: string; readonly entered: Set<string> }>;
}

/**
 * Where the folded record goes. The same values the fixtures were given.
 *
 * They have to match: the workers stage crossings recorded against one root and
 * one build's records, and this resolves them against whatever it is told. A
 * mismatch is not an error anybody sees — it is a record written under paths no
 * later run will ask about.
 */
export interface ExecutionReporterOptions {
  /**
   * A directory inside the repository; defaults to the cwd. Recorded paths are
   * relative to the checkout it sits in, never to it.
   */
  readonly root?: string;
  /** Where the coverage layers live. Defaults to the repository's cache. */
  readonly cacheRoot?: string;
  /** The coverage index. Defaults to the repository's cache. */
  readonly coverageFile?: string;
  /** The suite this run is, as the root `variance.config.json` declares it under `suites`. */
  readonly suite?: string;
  /**
   * The probe recipe the build placed, matching `testSelectionProbes()`'s
   * `mode`. `presence` when absent, as it is there.
   *
   * It has to be the same answer on both sides: a snapshot names the recipe
   * its ordinals were cut by, and a fold that claims another one refuses every
   * journal the run collected.
   */
  readonly mode?: InstrumentMode;
  /**
   * Files whose contents are preconditions of every spec this run recorded.
   *
   * A `globalSetup`, a fixture module the specs share, a seeded database
   * dump — nothing *enters* them, so no module row answers for them, and
   * without this a commit that edits one selects nothing at all.
   */
  readonly preconditions?: readonly string[];
}

/**
 * Fold every worker's contribution into one record, once, at the end of the run.
 *
 * Unnamed because a Playwright reporter is loaded by path and read off the
 * default export, so the name would be for nobody: the configuration names the
 * entrypoint, never the class.
 */
export default class implements Reporter {
  readonly #options: ExecutionReporterOptions;
  readonly #root: string;
  // Against `root`, as every other seam resolves them and as the fixture does:
  // the workers stage beside this snapshot, so the fold has to write the same one.
  readonly #coverageFile: string | undefined;
  readonly #snapshot: string;
  readonly #start: string;
  #directory: string | undefined;
  /** What the run failed on outside a test. */
  readonly #errors: TestError[] = [];
  /** The run's configuration, from `onBegin`, which Playwright calls before `onEnd` even when it found nothing. */
  #config: FullConfig | undefined;
  #projects: readonly FullProject[] = [];
  /** The collected cases that declare checks. */
  readonly #checked = new Map<TestCase, Checked>();
  /** Whether the runner ended the run itself, from `onEnd`. */
  #complete = false;
  /** The write that marks the record's checks incomplete until this run ends them. */
  #opened: Promise<void> | undefined;

  constructor(options: ExecutionReporterOptions = {}) {
    this.#options = options;
    const start = resolve(options.root ?? process.cwd());
    this.#start = start;
    this.#root = repositoryRoot(start);
    this.#coverageFile =
      options.coverageFile === undefined ? undefined : resolve(start, options.coverageFile);
    // Before any worker starts, so a suite the configuration does not declare
    // fails the run rather than the fold at its end.
    this.#snapshot = recordFileFor(this.#root, start, options);
  }

  /** Reporters print nothing here; the only lines are refusals, and those go to stderr. */
  printsToStdio(): boolean {
    return false;
  }

  /** Playwright 1.62 and newer: place a `--shard` by whole files, before Playwright would split it. */
  async preprocess(params: Preprocess): Promise<void> {
    this.#tellSelected(params.suite);
    const times = landingTimes(this.#snapshot, {
      root: this.#root,
      from: this.#start,
      ...(this.#options.suite === undefined ? {} : { suite: this.#options.suite }),
      byFile: this.#coverageFile !== undefined,
    });
    await placeWholeFiles(params, this.#root, times, (line) => process.stderr.write(`${line}\n`));
  }

  onBegin(config: FullConfig, suite: Suite): void {
    this.#config = config;
    // The projects it collected from: `--project` narrows these, never `config.projects`.
    this.#projects = suite.suites.flatMap((child) => child.project() ?? []);
    this.#tellSelected(suite);
    for (const test of suite.allTests()) {
      const declared = test.annotations.flatMap(({ type, description }) =>
        type === CHECK && description !== undefined ? [description] : []);
      if (declared.length === 0) continue;
      const { name, project } = testCaseOf(test);
      this.#checked.set(test, {
        file: fileOwner(this.#root, test.location.file),
        line: test.location.line,
        name,
        ...(project === undefined ? {} : { project }),
        declared: [...new Set(declared)].sort(codeUnitOrder),
        attempts: new Map(),
      });
    }
    // Before the first worker is forked, because a worker inherits the
    // environment as it stood when it started and has no other way to be told.
    // Beside the snapshot, so a suite that redirected its index redirects this
    // too and two projects sharing a checkout do not share a directory.
    this.#directory = resolve(dirname(this.#snapshot), `.run-${process.pid}-${randomUUID()}`);
    openStage(this.#directory);
    // A run killed before `onEnd` would leave the run before it answering, so
    // the record reads incomplete from here until this run says otherwise —
    // whether or not this run collected a case that declares a check.
    const cases = [...this.#checked.values()].map((one) => caseOf({ ...one, attempts: new Map() }));
    this.#opened = recordChecks(this.#where(), { complete: false, scope: this.#scope(), cases }).catch((error: unknown) => {
      process.stderr.write(`variance-authority: could not mark the record's checks incomplete — ${error instanceof Error ? error.message : String(error)}\n`);
    });
  }

  onTestBegin(test: TestCase, result: TestResult): void {
    this.#checked.get(test)?.attempts.set(result.retry + 1, { entered: new Set() });
  }

  /** At its end, because `test.step.skip` and `step.skip()` begin a step and only mark it skipped later. */
  onStepEnd(test: TestCase, result: TestResult, step: TestStep): void {
    const checked = this.#checked.get(test);
    if (step.category !== 'test.step' || !checked?.declared.includes(step.title)) return;
    if (step.annotations.some(({ type }) => type === 'skip')) return;
    checked.attempts.get(result.retry + 1)?.entered.add(step.title);
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const attempt = this.#checked.get(test)?.attempts.get(result.retry + 1);
    if (attempt !== undefined) attempt.ended = result.status;
  }

  onError(error: TestError): void {
    this.#errors.push(error);
  }

  async onEnd(result?: FullResult): Promise<{ status?: FullResult['status'] } | undefined> {
    // A run stopped by a signal or its global timeout cut its last attempts short.
    this.#complete = result?.status === 'passed' || result?.status === 'failed';
    await this.#fold();
    // A selection that skips every spec file is an answer, the change reached
    // no test the record holds, and the run passes; Playwright has no setting
    // that passes "No tests found" for a configuration to set. Only then: the
    // same error after a `--grep` or an empty `testDir` is the run's own.
    // Playwright serializes the error it throws, so its message keeps the name.
    const noTests =
      result?.status === 'failed' &&
      this.#errors.length === 1 &&
      this.#errors[0]!.message?.startsWith('Error: No tests found') === true;
    if (!noTests || !this.#emptied()) return undefined;
    this.#tellSelected(undefined);
    return { status: 'passed' };
  }

  /** Whether the selection dropped a spec file and kept none. */
  #emptied(): boolean {
    const asked = fileSelection();
    if (asked?.selection === undefined || asked.dropped.size === 0 || this.#config === undefined) return false;
    return keptFiles(asked, this.#config.projects.map((project) => project.testMatch)).length === 0;
  }

  /**
   * Say what the selection kept of the files Playwright found, once, from the
   * first place that has them: `preprocess` sees every file before a shard is
   * placed, `onBegin` is where a Playwright older than 1.62 first does, and a
   * run the selection emptied reaches neither with a test, so `onEnd` says it.
   */
  #tellSelected(suite: Suite | undefined): void {
    const asked = fileSelection();
    if (asked?.selection === undefined || asked.told) return;
    const found = new Set((suite?.allTests() ?? []).map((test) => fileOwner(asked.root, test.location.file)));
    if (found.size === 0 && suite !== undefined) return;
    for (const line of selectedLines(asked.selection, [...found, ...asked.dropped])) process.stderr.write(`${line}\n`);
    asked.told = true;
  }

  /** What the run covered: the projects it collected, their greps, its shard and the files a selection skipped. File filters are not kept. */
  #scope(): ChecksScope {
    const config = this.#config;
    if (config === undefined) return { projects: [] };
    // The runner's snapshot of its command line; a Playwright older than 1.64 hands none, and runs in this process.
    const argv = (config as { argv?: readonly string[] }).argv ?? process.argv;
    const skipped = fileSelection()?.dropped.size ?? 0;
    return {
      projects: this.#projects.map((project) => ({
        name: project.name,
        ...grepOf('grep', project.grep),
        ...grepOf('grepInvert', project.grepInvert ?? undefined),
      })),
      // Playwright keeps the command line's greps from every reporter, as
      // options of the run rather than of its configuration: its arguments are
      // the one place that still says them.
      ...commandLineGrep('grep', ['--grep', '-g'], argv),
      ...commandLineGrep('grepInvert', ['--grep-invert', '-G'], argv),
      ...(config.shard === null ? {} : { shard: { current: config.shard.current, total: config.shard.total } }),
      ...(skipped === 0 ? {} : { skipped }),
    };
  }

  /** The record this run's checks go into. */
  #where(): Parameters<typeof recordChecks>[0] {
    return {
      root: this.#root,
      ...(this.#coverageFile === undefined ? {} : { coverageFile: this.#coverageFile }),
      ...(this.#options.suite === undefined ? {} : { suite: this.#options.suite }),
    };
  }

  async #fold(): Promise<void> {
    const directory = this.#directory ?? stagingDirectory();
    if (directory === undefined) return;
    try {
      const staged = await foldStage(directory);
      const checks = { complete: this.#complete, scope: this.#scope(), cases: [...this.#checked.values()].map(caseOf) };
      const where = this.#where();
      await this.#opened;
      // A run that staged nothing — a grep or a selection that left no case —
      // still replaces the checks, or the run before it would answer for it.
      if (staged.subjects.length === 0) return await recordChecks(where, checks);
      const record = await recordExecution({
        root: this.#root,
        subjects: staged.subjects,
        ...(this.#options.cacheRoot === undefined ? {} : { cacheRoot: this.#options.cacheRoot }),
        ...(this.#coverageFile === undefined ? {} : { coverageFile: this.#coverageFile }),
        ...(this.#options.suite === undefined ? {} : { suite: this.#options.suite }),
        ...(this.#options.mode === undefined ? {} : { mode: this.#options.mode }),
        ...(this.#options.preconditions === undefined
          ? {}
          : { preconditions: this.#options.preconditions }),
        ...(staged.cases !== undefined && staged.cases.length > 0
          ? { cases: staged.cases }
          : {}),
        checks,
      });
      if (!record.recorded) {
        process.stderr.write(
          `variance-authority: recorded no test execution — ${record.because}\n`,
        );
        await recordChecks(where, checks);
      }
    } catch (error) {
      // The run is over and every verdict is already decided, so the expensive
      // thing has been bought. Losing the record costs the *next* selection its
      // narrowing, which is a full suite — the safe direction — while throwing
      // here would fail a run that passed.
      process.stderr.write(
        'variance-authority: recorded no test execution — the fold failed with ' +
          `${error instanceof Error ? error.message : String(error)}; this run is ` +
          'unaffected and the next `--since` will run every spec\n',
      );
    } finally {
      await closeStage(directory);
    }
  }
}

/** One case's checks as the record keeps them, its attempts in order. */
function caseOf({ attempts, ...rest }: Checked): { readonly attempts: readonly CheckedAttempt[] } & Omit<Checked, 'attempts'> {
  return {
    ...rest,
    attempts: [...attempts].sort(([a], [b]) => a - b).map(([attempt, { ended, entered }]) => ({
      attempt,
      ...(ended === undefined ? {} : { ended }),
      entered: [...entered].sort(codeUnitOrder),
    })),
  };
}
