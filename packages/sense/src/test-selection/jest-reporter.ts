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
import { digestString } from '@variance-authority/core';
import { INSTRUMENTATION_ID } from '../instrument/index.js';
import { commitOf } from './commit.js';
import { digestsOnDisk, existingCoverage, mergeCoverage } from './merge.js';
import {
  codeUnitOrder,
  coverageModule,
  crossingsOf,
  isMissing,
  projectPath,
  readInstrumentedModules,
  type CapturedModule,
} from './instrumented-modules.js';
import { inventoryFile, RUN_DIRECTORY_VARIABLE, type SelectionReporterConfig } from './jest.js';
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
  readonly config: { readonly cacheDirectory: string };
}

interface Journal {
  readonly testFile: string;
  readonly modules: ReadonlyArray<{
    /** `<absolute path>?<cache key>`, as the transformer numbered it. */
    readonly file: string;
    readonly hits: readonly number[];
    readonly shared: readonly number[];
  }>;
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
    const journals = await readJournals(runDirectory);
    const cacheDirectories = [...new Set([...contexts].map((context) => context.config.cacheDirectory))];
    const modules = await inventories(journals, cacheDirectories);

    const observed = crossingsOf(journals.map((journal) => ({
      testFile: projectPath(root, journal.testFile),
      modules: journal.modules.map((entered) => ({ ...entered, file: modules.get(entered.file)!.file })),
    })));

    const tests = await Promise.all(
      results.testResults.map((result) => coverageTest(result, this.#config, journals, modules)),
    );
    const commit = await commitOf(root);
    const current: TestCoverage = {
      version: 3,
      instrumentation: INSTRUMENTATION_ID,
      ...(commit === undefined ? {} : { commit }),
      tests: tests.sort((left, right) => codeUnitOrder(left.file, right.file)),
      modules: [...byFile(modules.values())]
        .map((module) => coverageModule(module, (block) => [...(observed.get(module.file)?.get(block.ordinal) ?? [])]))
        .sort((left, right) => codeUnitOrder(left.file, right.file)),
    };
    const previous = await existingCoverage(coverageFile);
    await writeTestCoverage(
      coverageFile,
      mergeCoverage(previous, current, await digestsOnDisk(root, previous, current)),
    );
    await rm(runDirectory, { recursive: true, force: true });
  }
}

/**
 * One module per file, out of the inventories the run's keys name for it.
 *
 * A multi-project run transforms one file under one key per project whose
 * options differ, and each key has its own inventory. The journals of both
 * projects report ordinals against the same file name, and an ordinal means
 * what its own inventory says: when the inventories agree block for block, one
 * of them speaks for the file; when they do not, the same ordinal is two
 * regions, and folding the hits together would put one project's tests in the
 * other's blocks. That file is recorded as one the build could not read, which
 * a selector answers by widening, rather than as regions nobody entered.
 */
function byFile(modules: Iterable<CapturedModule>): readonly CapturedModule[] {
  const versions = new Map<string, CapturedModule[]>();
  for (const module of modules) versions.set(module.file, [...(versions.get(module.file) ?? []), module]);
  const shape = (module: CapturedModule): string =>
    module.blocks.map((block) => `${block.ordinal}:${block.digest}`).join('\n');
  return [...versions.values()].map(([first, ...rest]) =>
    rest.every((other) => other.instrumented === first!.instrumented && shape(other) === shape(first!))
      ? first!
      : { file: first!.file, sourceDigest: first!.sourceDigest, instrumented: false, blocks: [] },
  );
}

/**
 * Every inventory the journals name, read once each.
 *
 * A journal naming a key no cache directory holds is a transform whose text
 * Jest kept and whose inventory something else discarded. Nothing here can
 * rebuild it — the inner transformer and its options live in the worker — and
 * recording the module without its blocks would read as *nobody entered this*.
 */
async function inventories(
  journals: readonly Journal[],
  cacheDirectories: readonly string[],
): Promise<ReadonlyMap<string, CapturedModule>> {
  const ids = new Set(journals.flatMap((journal) => journal.modules.map((entered) => entered.file)));
  const found = new Map<string, CapturedModule>();
  await Promise.all([...ids].map(async (id) => {
    const key = id.slice(id.lastIndexOf('?') + 1);
    for (const cacheDirectory of cacheDirectories) {
      const inventory = await readInstrumentedModules(inventoryFile(cacheDirectory, key));
      const module = inventory?.modules[0];
      if (module !== undefined) {
        found.set(id, module);
        return;
      }
    }
    throw new Error(
      `variance-authority lost the source identity for ${id.slice(0, id.lastIndexOf('?'))}; run \`jest --clearCache\` and record again`,
    );
  }));
  return found;
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
  journals: readonly Journal[],
  modules: ReadonlyMap<string, CapturedModule>,
): Promise<CoverageTest> {
  const file = projectPath(config.root, result.testFilePath);
  const preconditions: CoveragePrecondition[] = [];
  for (const input of [result.testFilePath, ...config.preconditions]) {
    preconditions.push({
      name: projectPath(config.root, input),
      digest: digestString(await readFile(input, 'utf8')),
    });
  }
  for (const journal of journals) {
    if (projectPath(config.root, journal.testFile) !== file) continue;
    for (const entered of journal.modules) {
      const module = modules.get(entered.file)!;
      preconditions.push({ name: module.file, digest: module.sourceDigest });
    }
  }
  const complete =
    !result.skipped &&
    result.testExecError === undefined &&
    result.testResults.length > 0 &&
    result.testResults.every((assertion) => assertion.status === 'passed');
  return { file, complete, preconditions };
}

async function readJournals(directory: string): Promise<readonly Journal[]> {
  let names: readonly string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  return Promise.all(
    names.map(async (name) => JSON.parse(await readFile(resolve(directory, name), 'utf8')) as Journal),
  );
}

export { SelectionReporter as default };
