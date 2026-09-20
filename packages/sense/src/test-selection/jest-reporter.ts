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
 * `onRunComplete` is the fold. Each journal names, per module, the path and the
 * cache key its probes were numbered by; the inventory under that key says what
 * the ordinals mean. The result is one `TestCoverage` for this run, layered
 * over what the coverage file already held.
 */

import { randomUUID } from 'node:crypto';
import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { digestString } from '../digest.js';
import { instrumentationId, type ModuleId } from '../instrument/index.js';
import { nameModules } from '../module-names.js';
import journalFormat from './journal-format.cjs';
import { executionIndexFrom, readCaseJournals } from './cases.js';
import { executionIndexBytes } from './execution-format.js';
import { commitOf } from './commit.js';
import { noteAnEmptyRecord } from './finished-files.js';
import { noteABusyIndex, withIndexLock } from './index-lock.js';
import { layeredCoverage } from './format-layer.js';
import {
  codeUnitOrder,
  crossingsOf,
  isMissing,
  loadedOf,
  moduleNamesFile,
  projectPath,
  readRecords,
  type CapturedModule,
  type ReadJournal,
} from './instrumented-modules.js';
import { coverageModule } from './coverage-rows.js';
import {
  CASE_DIRECTORY_VARIABLE,
  CONTINUATIONS_VARIABLE,
  jestStore,
  RUN_DIRECTORY_VARIABLE,
  type SelectionReporterConfig,
} from './jest.js';
import {
  seedTestCoverage,
  writeCoverageBytes,
  type CoveragePrecondition,
  type CoverageTest,
  type TestCoverage,
} from './index.js';

/** The fields of Jest's aggregated result this reads. */
export interface JestRunResults {
  readonly testResults: ReadonlyArray<{
    readonly testFilePath: string;
    readonly skipped: boolean;
    readonly testExecError?: unknown;
    readonly testResults: ReadonlyArray<{ readonly status: string }>;
  }>;
}

/** The field of a Jest test context this reads. */
export interface JestTestContext {
  readonly config: { readonly cacheDirectory: string; readonly id?: string };
}

class SelectionReporter {
  readonly #config: SelectionReporterConfig;
  #runDirectory: string | undefined;
  /** Beside the run directory rather than inside it: the fold there reads every name it finds. */
  #caseDirectory: string | undefined;

  constructor(_globalConfig: unknown, config: SelectionReporterConfig) {
    this.#config = config;
  }

  onRunStart(): void {
    this.#runDirectory = resolve(
      dirname(this.#config.coverageFile),
      `.run-${process.pid}-${randomUUID()}`,
    );
    process.env[RUN_DIRECTORY_VARIABLE] = this.#runDirectory;
    if (this.#config.cases !== true) return;
    this.#caseDirectory = `${this.#runDirectory}-cases`;
    process.env[CASE_DIRECTORY_VARIABLE] = this.#caseDirectory;
    if (this.#config.continuations === true) process.env[CONTINUATIONS_VARIABLE] = '1';
  }

  async onRunComplete(contexts: Iterable<JestTestContext>, results: JestRunResults): Promise<void> {
    const runDirectory = this.#runDirectory;
    if (runDirectory === undefined) return;
    const caseDirectory = this.#caseDirectory;
    delete process.env[RUN_DIRECTORY_VARIABLE];
    delete process.env[CASE_DIRECTORY_VARIABLE];
    delete process.env[CONTINUATIONS_VARIABLE];
    this.#runDirectory = undefined;
    this.#caseDirectory = undefined;

    const { root, coverageFile } = this.#config;
    const instrumentation = instrumentationId(this.#config.mode);
    const journals = await readJournals(runDirectory);
    const stores = [...new Set(
      [...contexts].map((context) => jestStore(context.config.cacheDirectory, context.config.id)),
    )];
    const modules = await records(journals, stores, instrumentation);

    const rows = journals.map((journal) => ({
      testFile: projectPath(root, journal.testFile),
      modules: journal.modules.filter((entered) => modules.has(entered.id)),
    }));
    const observed = crossingsOf(rows);
    const early = loadedOf(rows);

    const tests = await Promise.all(
      results.testResults.map((result) => coverageTest(result, this.#config, journals, modules)),
    );
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
    // A run that finished test files and placed no module at all is a seam that
    // never engaged — a `transform` the configuration overwrote, an `include`
    // that matched nothing — and the snapshot it just wrote says every one of
    // those files may be skipped. Said once, where the run ends.
    noteAnEmptyRecord(results.testResults.length, modules.size);
    // Beside the snapshot, never inside it. The snapshot answers *which files
    // must run*, its readers are unchanged, and a run that records cases writes
    // the same bytes there as one that does not.
    if (caseDirectory !== undefined) {
      const frames = await readCaseJournals(caseDirectory, root);
      const executionFile = this.#config.executionFile ?? `${coverageFile}.cases.bin`;
      await writeFile(
        executionFile,
        executionIndexBytes(executionFile, executionIndexFrom(frames, modules)),
      );
      await rm(caseDirectory, { recursive: true, force: true });
    }
    await rm(runDirectory, { recursive: true, force: true });
  }
}

/**
 * Every record the journals name, read once each.
 *
 * A journal naming an id no store holds is a transform whose text Jest kept and
 * whose record something else discarded. Nothing here can rebuild it — the
 * inner transformer and its options live in the worker — so the module is
 * dropped, and the file that entered it is recorded incomplete: a test file
 * with a crossing nobody can place is a file this run may not let a later one
 * skip.
 */
async function records(
  journals: readonly ReadJournal[],
  stores: readonly string[],
  instrumentation: string,
): Promise<ReadonlyMap<ModuleId, CapturedModule>> {
  return readRecords(
    stores,
    journals.flatMap((journal) => journal.modules.map((entered) => entered.id)),
    instrumentation,
  );
}

/**
 * One test file's observation, and whether it was whole.
 *
 * Whole means every case in the file ran and passed. A skipped file, a file
 * that failed to load, a case that was pending, skipped, or focused past, and a
 * failing case each leave the observation partial: what the file did not run
 * it did not enter, and a selector must not read that absence as evidence.
 */
async function coverageTest(
  result: JestRunResults['testResults'][number],
  config: SelectionReporterConfig,
  journals: readonly ReadJournal[],
  modules: ReadonlyMap<ModuleId, CapturedModule>,
): Promise<CoverageTest> {
  const file = projectPath(config.root, result.testFilePath);
  const preconditions: CoveragePrecondition[] = [];
  for (const input of [result.testFilePath, ...config.preconditions]) {
    preconditions.push({
      name: projectPath(config.root, input),
      digest: digestString(await readFile(input, 'utf8')),
    });
  }
  let placed = true;
  // Whether the file left a journal at all. Its `afterAll` is what writes one,
  // and a runner that has no test to run in a file runs none of the file's
  // hooks — so a file whose every test is skipped is announced as finished,
  // counts as a usable outcome below, and carries no record of the modules its
  // collection did enter. Recorded whole, that empty reach excludes the file
  // from every diff there will ever be.
  let recorded = false;
  for (const journal of journals) {
    if (projectPath(config.root, journal.testFile) !== file) continue;
    recorded = true;
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
  const complete =
    placed &&
    recorded &&
    result.testExecError === undefined &&
    result.testResults.length > 0 &&
    result.testResults.every(
      (assertion) => assertion.status === 'passed' || assertion.status === 'pending' || assertion.status === 'todo',
    );
  return { file, complete, preconditions };
}

async function readJournals(directory: string): Promise<readonly ReadJournal[]> {
  let names: readonly string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  return Promise.all(
    names.map(async (name) => journalFormat.decodeJournal(await readFile(resolve(directory, name)))),
  );
}

export { SelectionReporter as default };
