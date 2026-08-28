import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { digestString } from '@variance-authority/core';
import type { Reporter } from 'vitest/reporters';
import type { UserConfig } from 'vitest/config';
import { INSTRUMENTATION_ID, instrument } from '../instrument/index.js';
import { decodeTestCoverage, encodeTestCoverage } from './format.js';
import { mergeCoverage } from './merge.js';
import {
  cleanId,
  codeUnitOrder,
  coverageBlock,
  defaultInclude,
  isMissing,
  projectPath,
  type CapturedModule,
} from './instrumented-modules.js';
import {
  testCoverageFile,
  type CoverageModule,
  type CoveragePrecondition,
  type CoverageTest,
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
}

interface VitePlugin {
  readonly name: string;
  readonly enforce: 'post';
  readonly resolveId: (id: string) => string | null;
  readonly load: (id: string) => string | null;
  readonly transform: (code: string, id: string) => { code: string; map: null } | null;
}

interface Journal {
  readonly testFile: string;
  readonly modules: ReadonlyArray<{ readonly file: string; readonly hits: readonly number[] }>;
}

interface RunnerTask {
  readonly filepath?: string;
  readonly result?: { readonly state: string };
  readonly tasks?: readonly RunnerTask[];
}

/**
 * Add source instrumentation, test-file attribution, and coverage persistence to
 * an ordinary Vitest configuration.
 */
export function withTestSelection(
  config: UserConfig = {},
  options: TestSelectionOptions = {},
): UserConfig {
  const root = resolve(options.root ?? config.root ?? process.cwd());
  const coverageFile = options.coverageFile === undefined
    ? testCoverageFile(root)
    : resolve(root, options.coverageFile);
  const runDirectory = resolve(dirname(coverageFile), `.run-${process.pid}-${randomUUID()}`);
  const setupId = resolve(root, '.variance-authority/test-selection-setup.js');
  const modules = new Map<string, CapturedModule>();
  const include = options.include ?? defaultInclude;
  const plugin = selectionPlugin(root, runDirectory, setupId, modules, include);
  const setupFiles = array(config.test?.setupFiles);
  const preconditions = [...setupFiles, ...(options.preconditions ?? [])]
    .filter((file): file is string => typeof file === 'string')
    .map((file) => resolve(root, file));
  const reporter = selectionReporter(coverageFile, runDirectory, modules, root, preconditions);
  const reporters = config.test?.reporters === undefined ? ['default'] : array(config.test.reporters);

  return {
    ...config,
    plugins: [...array(config.plugins), plugin],
    test: {
      ...config.test,
      setupFiles: [...setupFiles, setupId],
      reporters: [...reporters, reporter],
    },
  };
}

function selectionPlugin(
  root: string,
  runDirectory: string,
  setupId: string,
  modules: Map<string, CapturedModule>,
  include: (file: string) => boolean,
): VitePlugin {
  const virtualId = '\0variance-authority:test-selection-setup';

  return {
    name: 'variance-authority:test-selection',
    enforce: 'post',
    resolveId: (id) => (id === setupId ? virtualId : null),
    load: (id) => (id === virtualId ? setupSource(runDirectory) : null),
    transform(code, id) {
      const file = cleanId(id);
      if (!include(file)) return null;

      const done = instrument(code, file);
      if (done === undefined) {
        modules.set(file, {
          file: projectPath(root, file),
          sourceDigest: digestString(code),
          instrumented: false,
          blocks: [],
        });
        return null;
      }

      modules.set(file, {
        file: projectPath(root, file),
        sourceDigest: done.sourceDigest,
        instrumented: true,
        blocks: done.blocks.map((block) => coverageBlock(code, block)),
      });
      return { code: done.code, map: null };
    },
  };
}

function selectionReporter(
  coverageFile: string,
  runDirectory: string,
  modules: ReadonlyMap<string, CapturedModule>,
  root: string,
  preconditionFiles: readonly string[],
): Reporter {
  return {
    async onFinished(files) {
      const journals = await readJournals(runDirectory);
      const observed = new Map<string, Map<number, Set<string>>>();

      for (const journal of journals) {
        const testFile = projectPath(root, journal.testFile);
        for (const module of journal.modules) {
          const moduleFile = projectPath(root, module.file);
          const byOrdinal = observed.get(moduleFile) ?? new Map<number, Set<string>>();
          for (const ordinal of module.hits) {
            const tests = byOrdinal.get(ordinal) ?? new Set<string>();
            tests.add(testFile);
            byOrdinal.set(ordinal, tests);
          }
          observed.set(moduleFile, byOrdinal);
        }
      }

      const tests = await Promise.all(
        files.flatMap((file) => file.filepath === undefined
          ? []
          : [coverageTest(file, root, preconditionFiles, journals, modules)]),
      );
      const current: TestCoverage = {
        version: 2,
        instrumentation: INSTRUMENTATION_ID,
        tests: tests.sort((left, right) => codeUnitOrder(left.file, right.file)),
        modules: [...modules.values()]
          .map((module): CoverageModule => ({
            file: module.file,
            sourceDigest: module.sourceDigest,
            instrumented: module.instrumented,
            blocks: module.blocks.map((block) => ({
              ...block,
              testFiles: [...(observed.get(module.file)?.get(block.ordinal) ?? [])].sort(codeUnitOrder),
            })),
          }))
          .sort((left, right) => codeUnitOrder(left.file, right.file)),
      };
      const previous = await existingCoverage(coverageFile);
      await mkdir(dirname(coverageFile), { recursive: true });
      const temporary = `${coverageFile}.${process.pid}-${randomUUID()}.tmp`;
      await writeFile(temporary, encodeTestCoverage(mergeCoverage(previous, current)));
      await rename(temporary, coverageFile);
      await rm(runDirectory, { recursive: true, force: true });
    },
  };
}

function setupSource(runDirectory: string): string {
  return `
import { afterAll, expect } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const modules = new Map();
globalThis.__VA__ = (file, count) => {
  const counters = new Uint32Array(count);
  modules.set(file, counters);
  return counters;
};
afterAll(async () => {
  const testFile = expect.getState().testPath;
  if (!testFile) throw new Error('variance-authority could not identify the current Vitest file');
  const journal = { testFile, modules: [...modules].map(([file, counters]) => ({
    file,
    hits: [...counters].flatMap((count, ordinal) => count === 0 ? [] : [ordinal]),
  })) };
  await mkdir(${JSON.stringify(runDirectory)}, { recursive: true });
  await writeFile(${JSON.stringify(`${runDirectory}/`)} + process.pid + '-' + randomUUID() + '.json', JSON.stringify(journal));
});`;
}

function fileComplete(file: RunnerTask): boolean {
  const leaves = (task: RunnerTask): readonly RunnerTask[] =>
    task.tasks === undefined || task.tasks.length === 0 ? [task] : task.tasks.flatMap(leaves);
  const tests = leaves(file);
  return tests.length > 0 && tests.every((task) => task.result?.state === 'pass');
}

async function coverageTest(
  task: RunnerTask & { readonly filepath: string },
  root: string,
  preconditionFiles: readonly string[],
  journals: readonly Journal[],
  modules: ReadonlyMap<string, CapturedModule>,
): Promise<CoverageTest> {
  const file = projectPath(root, task.filepath);
  const preconditions: CoveragePrecondition[] = [];
  for (const input of [task.filepath, ...preconditionFiles]) {
    preconditions.push({
      name: projectPath(root, input),
      digest: digestString(await readFile(input, 'utf8')),
    });
  }
  for (const journal of journals) {
    if (projectPath(root, journal.testFile) !== file) continue;
    for (const entered of journal.modules) {
      const module = modules.get(entered.file);
      if (module === undefined) {
        throw new Error(`variance-authority lost the source identity for ${entered.file}`);
      }
      preconditions.push({ name: module.file, digest: module.sourceDigest });
    }
  }
  return { file, complete: fileComplete(task), preconditions };
}

async function readJournals(directory: string): Promise<readonly Journal[]> {
  let names: readonly string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  return Promise.all(names.map(async (name) => JSON.parse(await readFile(resolve(directory, name), 'utf8')) as Journal));
}

async function existingCoverage(file: string): Promise<TestCoverage | undefined> {
  try {
    return decodeTestCoverage(await readFile(file));
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

function array<T>(value: T | readonly T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? [...value] : [value as T];
}

export { mergeCoverage } from './merge.js';
