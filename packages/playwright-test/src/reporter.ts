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
 */

import type { FullConfig, Reporter } from '@playwright/test/reporter';
import {
  closeStage,
  foldStage,
  openStage,
  recordExecution,
  stagingDirectory,
  type InstrumentMode,
} from '@variance-authority/sense/journal';
import { repositoryRoot, testCoverageFile } from '@variance-authority/sense/test-selection';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

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
  /** Matches the `label` given to `testSelectionProbes()`. Defaults to `build`. */
  readonly label?: string;
  /** Where that build wrote its records. Defaults to the user cache. */
  readonly cacheRoot?: string;
  /** The coverage index. Defaults to the repository-keyed user cache. */
  readonly coverageFile?: string;
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
  /**
   * Also write the execution index: which individual test entered which region.
   *
   * Off by default, and left off for most suites. The index answers *which
   * tests walk this branch* — the question `variance covering` and
   * `@variance-authority/distill` are asked — and it is a row per test per
   * region, so a suite that indexes to answer a question nobody asks has bought
   * a large file and nothing else. Whether the workers produced any is theirs
   * to decide; this only writes what arrived.
   */
  readonly cases?: boolean;
  /**
   * Where that index goes. Defaults beside the snapshot: `<coverage file>.cases.bin`;
   * a name ending `.json` is written as JSON instead, at the size JSON costs.
   */
  readonly executionFile?: string;
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
  readonly #executionFile: string | undefined;
  #directory: string | undefined;

  constructor(options: ExecutionReporterOptions = {}) {
    this.#options = options;
    const start = resolve(options.root ?? process.cwd());
    this.#root = repositoryRoot(start);
    this.#coverageFile =
      options.coverageFile === undefined ? undefined : resolve(start, options.coverageFile);
    this.#executionFile =
      options.executionFile === undefined ? undefined : resolve(start, options.executionFile);
  }

  /** Reporters print nothing here; the only lines are refusals, and those go to stderr. */
  printsToStdio(): boolean {
    return false;
  }

  onBegin(_config: FullConfig): void {
    // Before the first worker is forked, because a worker inherits the
    // environment as it stood when it started and has no other way to be told.
    // Beside the snapshot, so a suite that redirected its index redirects this
    // too and two projects sharing a checkout do not share a directory.
    const snapshot = this.#coverageFile ?? testCoverageFile(this.#root);
    this.#directory = resolve(dirname(snapshot), `.run-${process.pid}-${randomUUID()}`);
    openStage(this.#directory);
  }

  async onEnd(): Promise<void> {
    const directory = this.#directory ?? stagingDirectory();
    if (directory === undefined) return;
    try {
      const staged = await foldStage(directory);
      if (staged.subjects.length === 0) return;
      const record = await recordExecution({
        root: this.#root,
        subjects: staged.subjects,
        ...(this.#options.label === undefined ? {} : { label: this.#options.label }),
        ...(this.#options.cacheRoot === undefined ? {} : { cacheRoot: this.#options.cacheRoot }),
        ...(this.#coverageFile === undefined ? {} : { coverageFile: this.#coverageFile }),
        ...(this.#options.mode === undefined ? {} : { mode: this.#options.mode }),
        ...(this.#options.preconditions === undefined
          ? {}
          : { preconditions: this.#options.preconditions }),
        ...(staged.heads === undefined || staged.heads.length === 0
          ? {}
          : { heads: staged.heads }),
        ...(this.#options.cases === true && staged.cases !== undefined && staged.cases.length > 0
          ? { cases: staged.cases }
          : {}),
        ...(this.#executionFile === undefined ? {} : { executionFile: this.#executionFile }),
      });
      if (!record.recorded) {
        process.stderr.write(
          `variance-authority: recorded no test execution — ${record.because}\n`,
        );
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
