/**
 * The Jest reporter: names the run, then lands what the run recorded.
 *
 * Constructed by Jest in the parent process. `onRunStart` is dispatched before
 * the runner forks its workers, and `jest-worker` forks each one with a copy of
 * `process.env` taken at that moment, so a directory named here in the
 * environment is the directory every sandbox's `afterAll` writes to — with no
 * configuration carrying a path that must differ per run, and no channel from
 * the parent to the workers that Jest does not already have. An in-band run
 * reads the same variable from the same process.
 *
 * Each journal names, per module, the file and the text its probes were placed
 * on, and the fold cuts that text again to read them. A journey-only run seals
 * its journals for a post-Jest fold. A selection run folds its file-level
 * journals here and layers the result over its snapshot.
 */

import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { codeUnitOrder } from '@variance-authority/core/segment';
import type { Digest } from '../digest.js';
import { runTexts } from '../text-digests.js';
import { instrumentationId, type InstrumentMode, type ModuleId } from '../instrument/index.js';
import { probesRegions } from '../instrument/identity.js';
import { askedForStories } from '../story/directory.js';
import { CUT_VARIABLE, cutFiles, removeCut } from './case-cut.js';
import { freshCases } from './case-fold.js';
import { caseDurations, finishedCase } from './case-durations.js';
import { stageJestJourneys } from './jest-journey-artifact.js';
import { commitOf } from './commit.js';
import { noteAnEmptyRecord, statusesComplete } from './finished-files.js';
import { jestPhases, reportedDuration, type JestPerfStats } from './reported-time.js';
import { journalsOf, oneTestPerFile, projectNamed, readProjectJournals } from './jest-projects.js';
import { noteABusyIndex, withIndexLock } from './index-lock.js';
import { landRun } from './commit-runs.js';
import { markCheckout } from './cache-layers.js';
import { repositoryRoot } from './repository-root.js';
import {
  crossingsOf,
  loadedOf,
  projectPath,
  type CapturedModule,
  type ReadJournal,
} from './instrumented-modules.js';
import { coverageModule } from './coverage-rows.js';
import { deriveModules } from './captured-modules.js';
import {
  CASE_DIRECTORY_VARIABLE,
  CONTINUATIONS_VARIABLE,
  STORY_DIRECTORY_VARIABLE,
  RUN_DIRECTORY_VARIABLE,
  SELECTION_GLOBALS,
  SELECTION_SETUP,
  type SelectionReporterConfig,
} from './jest.js';
import {
  noteSeeded,
  seedTestCoverage,
  type CoveragePrecondition,
  type CoverageTest,
  type TestCoverage,
} from './index.js';
import { recordsAlone } from './record-location.js';

/**
 * Set beside the case directory to the checkout the record names files against,
 * and read by `jest-globals.cts`: given, the case scope keeps the journals Eyes
 * hands it, with every source location spelled against the same root.
 */
const ROOT_VARIABLE = 'VARIANCE_AUTHORITY_TEST_SELECTION_ROOT';

/** The fields of Jest's aggregated result this reads. */
export interface JestRunResults {
  readonly testResults: ReadonlyArray<{
    readonly testFilePath: string;
    readonly skipped: boolean;
    readonly testExecError?: unknown;
    /** The project that ran the file, as its configuration names it: a string or `{ name, color }`. */
    readonly displayName?: unknown;
    /** Each case as Jest reported it: `fullName` is the `currentTestName` the case scope records it by. */
    readonly testResults: ReadonlyArray<{
      readonly status: string;
      readonly fullName?: string;
      readonly duration?: number | null;
    }>;
    readonly perfStats?: JestPerfStats;
  }>;
}

/** The field of a Jest test context this reads. */
export interface JestTestContext {
  readonly config: {
    readonly cacheDirectory: string;
    readonly id?: string;
    /** Resolved by Jest: a path for a file of the project's, and for a package, into its install. */
    readonly setupFiles?: readonly string[];
    readonly setupFilesAfterEnv?: readonly string[];
    readonly testEnvironment?: string;
    readonly testEnvironmentOptions?: { readonly varianceAuthority?: { readonly environment?: string } };
  };
}

/** A test file Jest ran, and the project configuration it ran under. */
export interface JestTest {
  readonly path: string;
  readonly context: JestTestContext;
}

interface JourneyReporterConfig {
  readonly root: string;
  readonly journeyFile: string;
  readonly mode?: InstrumentMode;
  readonly continuations?: boolean;
  readonly parts?: readonly string[];
}

type JestReporterConfig = SelectionReporterConfig | JourneyReporterConfig;

class JestCoverageReporter {
  readonly #config: JestReporterConfig;
  #runDirectory: string | undefined;
  /** Beside the run directory rather than inside it: the fold there reads every name it finds. */
  #caseDirectory: string | undefined;

  /**
   * The files each test file's own project rests on, as Jest resolved that
   * project — see {@link projectPreconditions}.
   */
  readonly #governing = new Map<string, Set<string>>();

  /** Whether this run is one shard of a run that selects nothing — see `recordsAlone`. */
  readonly #alone: boolean;

  /**
   * Whether `-t` chose the cases this run ran. Jest reports every case it left
   * out as pending, which is how a case its file skips reads too, so under a
   * filter no pending case is the file's own.
   */
  readonly #named: boolean;

  /** When `onRunStart` began this run: see `runTexts`. */
  #startedAt = 0;

  constructor(
    globalConfig: { readonly shard?: unknown; readonly testNamePattern?: string } | undefined,
    config: JestReporterConfig,
  ) {
    this.#config = config;
    this.#named = (globalConfig?.testNamePattern ?? '') !== '';
    this.#alone = recordsAlone(globalConfig?.shard != null, 'selected' in config && config.selected === true);
  }

  onTestFileResult(test: JestTest): void {
    const own = this.#governing.get(test.path) ?? new Set<string>();
    for (const file of projectPreconditions(test.context.config)) own.add(file);
    this.#governing.set(test.path, own);
  }

  onRunStart(): void {
    this.#startedAt = Date.now();
    const recordFile = 'journeyFile' in this.#config ? this.#config.journeyFile : this.#config.coverageFile;
    this.#runDirectory = resolve(dirname(recordFile), `.run-${process.pid}-${randomUUID()}`);
    process.env[RUN_DIRECTORY_VARIABLE] = this.#runDirectory;
    process.env[ROOT_VARIABLE] = this.#config.root;
    // A Jest started inside a recording run inherits its case scope; the
    // workers read what this run sets, and nothing it does not.
    delete process.env[CASE_DIRECTORY_VARIABLE];
    delete process.env[CONTINUATIONS_VARIABLE];
    delete process.env[STORY_DIRECTORY_VARIABLE];
    // Under `loads` a module is marked as its file loads it, before any case
    // opens: with no case directory the setup file keeps one bucket per file.
    if (!probesRegions(this.#config.mode)) return;
    this.#caseDirectory = `${this.#runDirectory}-cases`;
    process.env[CASE_DIRECTORY_VARIABLE] = this.#caseDirectory;
    if (this.#config.continuations === true) process.env[CONTINUATIONS_VARIABLE] = '1';
    const stories = askedForStories(recordFile);
    if (stories !== undefined) process.env[STORY_DIRECTORY_VARIABLE] = stories;
  }

  async onRunComplete(_contexts: Iterable<JestTestContext>, results: JestRunResults): Promise<void> {
    const runDirectory = this.#runDirectory;
    if (runDirectory === undefined) return;
    const caseDirectory = this.#caseDirectory;
    delete process.env[RUN_DIRECTORY_VARIABLE];
    delete process.env[CASE_DIRECTORY_VARIABLE];
    delete process.env[CONTINUATIONS_VARIABLE];
    delete process.env[STORY_DIRECTORY_VARIABLE];
    delete process.env[ROOT_VARIABLE];
    // The files the selection ran in part, which the filter named before the
    // run began; each is recorded incomplete. See `case-cut.ts`.
    const cutFile = process.env[CUT_VARIABLE];
    const cut = cutFiles(cutFile);
    removeCut(cutFile);
    delete process.env[CUT_VARIABLE];
    this.#runDirectory = undefined;
    this.#caseDirectory = undefined;

    const { root } = this.#config;
    const { mode } = this.#config;
    const instrumentation = instrumentationId(mode);

    if ('journeyFile' in this.#config) {
      const cases = caseDirectory ?? `${runDirectory}-cases`;
      await stageJestJourneys(this.#config.journeyFile, cases, runDirectory, {
        version: 2,
        root,
        ...(mode === undefined ? {} : { mode }),
        parts: this.#config.parts ?? [],
      });
      return;
    }

    const written = await readProjectJournals(runDirectory);
    const journals = written.map((entry) => entry.journal);
    // A module whose file is gone is left out, and the file that entered it is
    // recorded incomplete: a crossing nobody can place is one this run may not
    // let a later run skip on.
    const modules = await deriveModules(
      root,
      journals.flatMap((journal) => journal.modules.map((entered) => entered.id)),
      mode,
    );
    const selection = this.#config;
    const { coverageFile } = selection;

    const rows = journals.map((journal) => ({
      testFile: projectPath(root, journal.testFile),
      modules: journal.modules.filter((entered) => modules.has(entered.id)),
    }));
    const observed = crossingsOf(rows);
    const early = loadedOf(rows);

    const governed = results.testResults.map((result) => ({
      result,
      governing: [...(selection.declared ?? []), ...(this.#governing.get(result.testFilePath) ?? selection.preconditions)],
    }));
    const texts = runTexts(governed.map(({ result, governing }) => ({ test: result.testFilePath, governing })), this.#startedAt);
    const tests = oneTestPerFile(governed.map(({ result, governing }) => coverageTest(
      result,
      cut.has(result.testFilePath) || texts.moved(result.testFilePath, governing),
      this.#named,
      selection,
      governing,
      texts.digests,
      journalsOf(written, projectNamed(result.displayName)),
      modules,
    )));
    const commit = await commitOf(root);
    const current: TestCoverage = {
      version: 3,
      instrumentation,
      ...(commit === undefined ? {} : { commit }),
      tests: tests.sort((left, right) => codeUnitOrder(left.file, right.file)),
      modules: [...modules]
        .map(([id, module]) => coverageModule(
          module,
          (block) => [...(observed.get(id)?.get(block.ordinal) ?? [])],
          (block) => [...(early.get(id)?.get(block.ordinal) ?? [])],
        ))
        .sort((left, right) => codeUnitOrder(left.file, right.file)),
    };
    // The repository's snapshot becomes this checkout's before the first run
    // lands on it, so a worktree layers onto months of recording rather than
    // onto nothing. A no-op in the primary checkout and after the first run,
    // and not asked by a shard that is a part of one whole run.
    if (!this.#alone) noteSeeded(await seedTestCoverage(coverageFile, root, current.instrumentation));
    // In the record, with the coverage, in one write. A run that recorded no
    // case and finished no file has none to lay, and the record's cases stay
    // as they were.
    const cases = caseDirectory === undefined
      ? undefined
      : await freshCases(caseDirectory, root, modules, {
          tests,
          ...(commit === undefined ? {} : { commit }),
          durations: caseDurations(results.testResults.map((result) => ({
            filepath: result.testFilePath,
            cases: result.testResults.map((test) => finishedCase(test.fullName ?? '', undefined, test.duration)),
          })), root),
        });
    const merged = await withIndexLock(coverageFile, async () => {
      await landRun(coverageFile, current, root, undefined, cases);
      markCheckout(repositoryRoot(root));
    });
    // A run that finished test files and placed no module at all is a seam that
    // never engaged — a `transform` the configuration overwrote, an `include`
    // that matched nothing — and the snapshot it just wrote says every one of
    // those files may be skipped. Said once, where the run ends. A run the lock
    // refused wrote no snapshot, and the busy warning is the whole story.
    if (merged.held) noteAnEmptyRecord(results.testResults.length, modules.size);
    else noteABusyIndex(coverageFile);
    if (caseDirectory !== undefined) await rm(caseDirectory, { recursive: true, force: true });
    await rm(runDirectory, { recursive: true, force: true });
  }
}

/** Jest's case statuses in the words `statusesComplete` reads; any other is not an outcome. */
const jestOutcomes: Readonly<Record<string, string>> = { passed: 'pass', pending: 'skip', todo: 'todo' };

/**
 * One test file's observation, and whether it was whole.
 *
 * Whole means every case in the file ran and passed. A skipped file, a file
 * that failed to load, a case that was pending, skipped, or focused past, and a
 * failing case each leave the observation partial: what the file did not run
 * it did not enter, and a selector must not read that absence as evidence.
 */
function coverageTest(
  result: JestRunResults['testResults'][number],
  /**
   * Whether the record of the file is partial: the selection skipped some of
   * its cases, whose reach the run then did not record, or a text it rests on
   * was written while it ran.
   */
  partial: boolean,
  /** Whether a name filter ran, which reports every case it left out as pending. */
  named: boolean,
  config: SelectionReporterConfig,
  governing: readonly string[],
  /** Every file's text digest, from `textDigests`, read once for the whole run. */
  digests: ReadonlyMap<string, Digest>,
  journals: readonly ReadJournal[],
  modules: ReadonlyMap<ModuleId, CapturedModule>,
): CoverageTest {
  const file = projectPath(config.root, result.testFilePath);
  const preconditions: CoveragePrecondition[] = [];
  for (const input of new Set([result.testFilePath, ...governing])) {
    preconditions.push({
      name: projectPath(config.root, input),
      digest: digests.get(input)!,
    });
  }
  let placed = true;
  // Whether the file left a journal at all. Its `afterAll` is what writes one,
  // and a runner that has no test to run in a file runs none of the file's
  // hooks — so a file whose every test is skipped is announced as finished,
  // counts as a usable outcome below, and carries no record of the modules its
  // collection did enter. Recorded whole, that empty reach excludes the file
  // from every diff there will ever be. `journals` are this result's project's
  // own: another project's journal for the same path is not this one's, as far
  // as the projects' names tell them apart. Unnamed projects share their
  // journals, so the marks go to `jestPhases`, which keeps the run's own.
  let recorded = false;
  const marks: number[] = [];
  for (const journal of journals) {
    if (projectPath(config.root, journal.testFile) !== file) continue;
    recorded = true;
    if (journal.collected !== undefined) marks.push(journal.collected);
    for (const entered of journal.modules) {
      const module = modules.get(entered.id);
      if (module === undefined) placed = false;
      // Only what the instrument could not see inside, as `vitest.ts` says at
      // more length: an instrumented module already carries its own digest.
      else if (!module.instrumented) {
        preconditions.push({ name: module.file, digest: module.sourceDigest });
      }
    }
  }
  // `passed` or skipped, for the reason `vitest.ts` gives beside `usableOutcome`:
  // a test that did not run cannot fail, and every way one stops being skipped
  // edits either the test file or a module its collection entered, both of which
  // already select it. A failure or an error is a different thing and still
  // spoils the file — it recorded only as far as it got.
  const complete = !partial && placed && recorded && statusesComplete(
    result.testExecError === undefined ? 'pass' : 'fail',
    result.testResults.map((assertion) => jestOutcomes[assertion.status] ?? 'fail'),
    named,
  );
  return {
    file,
    complete,
    preconditions,
    ...reportedDuration(result.perfStats?.runtime),
    ...jestPhases(result.perfStats, marks),
  };
}

/**
 * The setup and environment files one Jest project rests on, as Jest resolved
 * them for the test it ran.
 *
 * A project of an inline `projects` list governs its own tests: a change to a
 * browser project's environment does not change what a node project's test
 * ran. So each test is charged its own project's files, asked of the context
 * Jest ran it in rather than matched back to a project here. A package — the
 * environment `node`, `jest-canvas-mock` — resolves into the install, which is
 * no file a diff of the project can carry, and this seam's own two files are no
 * precondition of anybody's.
 */
function projectPreconditions(config: JestTestContext['config']): readonly string[] {
  const environment = config.testEnvironmentOptions?.varianceAuthority?.environment ?? config.testEnvironment;
  return [
    ...(environment === undefined ? [] : [environment]),
    ...(config.setupFiles ?? []),
    ...(config.setupFilesAfterEnv ?? []),
  ].filter((file) =>
    isAbsolute(file) &&
    !file.split(sep).includes('node_modules') &&
    file !== SELECTION_GLOBALS &&
    file !== SELECTION_SETUP);
}

export { JestCoverageReporter as default };
