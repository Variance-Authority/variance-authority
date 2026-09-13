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
import { readFile, readdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { digestString } from '../digest.js';
import { instrumentationId, type ModuleId } from '../instrument/index.js';
import { nameModules } from '../module-names.js';
import journalFormat from './journal-format.cjs';
import { commitOf } from './commit.js';
import { existingCoverage, mergeCoverage, sourcesOnDisk } from './merge.js';
import {
  codeUnitOrder,
  coverageModule,
  crossingsOf,
  isMissing,
  loadedOf,
  moduleNamesFile,
  projectPath,
  readRecords,
  type CapturedModule,
  type ReadJournal,
} from './instrumented-modules.js';
import { jestStore, RUN_DIRECTORY_VARIABLE, type SelectionReporterConfig } from './jest.js';
import {
  writeTestCoverage,
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

  constructor(_globalConfig: unknown, config: SelectionReporterConfig) {
    this.#config = config;
  }

  onRunStart(): void {
    this.#runDirectory = resolve(
      dirname(this.#config.coverageFile),
      `.run-${process.pid}-${randomUUID()}`,
    );
    process.env[RUN_DIRECTORY_VARIABLE] = this.#runDirectory;
  }

  async onRunComplete(contexts: Iterable<JestTestContext>, results: JestRunResults): Promise<void> {
    const runDirectory = this.#runDirectory;
    if (runDirectory === undefined) return;
    delete process.env[RUN_DIRECTORY_VARIABLE];
    this.#runDirectory = undefined;

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
    const previous = await existingCoverage(coverageFile);
    await writeTestCoverage(
      coverageFile,
      mergeCoverage(previous, current, await sourcesOnDisk(root, previous, current)),
    );
    // Everything this run saw, numbered for the next one. A file first met today
    // was instrumented under its path; from here on it has a number.
    await nameModules(moduleNamesFile(root), [...modules.values()].map((module) => module.file));
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
  for (const journal of journals) {
    if (projectPath(config.root, journal.testFile) !== file) continue;
    for (const entered of journal.modules) {
      const module = modules.get(entered.id);
      if (module === undefined) placed = false;
      else preconditions.push({ name: module.file, digest: module.sourceDigest });
    }
  }
  const complete =
    placed &&
    !result.skipped &&
    result.testExecError === undefined &&
    result.testResults.length > 0 &&
    result.testResults.every((assertion) => assertion.status === 'passed');
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
