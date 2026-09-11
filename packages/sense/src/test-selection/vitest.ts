import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, readdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { digestString } from '@variance-authority/core/format';
import type { Reporter } from 'vitest/reporters';
import type { UserConfig } from 'vitest/config';
import { EVALUATING, INSTRUMENTATION_ID, instrument } from '../instrument/index.js';
import { priorMap, type TransformingContext } from './probes.js';
import { commitOf } from './commit.js';
import { digestsOnDisk, existingCoverage, mergeCoverage } from './merge.js';
import {
  cleanId,
  codeUnitOrder,
  coverageBlock,
  crossingsOf,
  defaultInclude,
  isMissing,
  projectPath,
  type CapturedModule,
} from './instrumented-modules.js';
import { sourceLines } from './source-lines.js';
import {
  testCoverageFile,
  writeTestCoverage,
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
  readonly transform: (
    this: TransformingContext,
    code: string,
    id: string,
  ) => { code: string; map: null } | null;
}

interface Journal {
  readonly testFile: string;
  readonly modules: ReadonlyArray<{
    readonly file: string;
    readonly hits: readonly number[];
    /** Entered while a module was evaluating, so every file the run ran owns it. */
    readonly shared: readonly number[];
  }>;
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
  // A setup entry may be a package — `dotenv/config` — rather than a file of
  // the project's; a package is no precondition a diff can carry, and read as a
  // path it is a missing file that fails the reporter and loses the snapshot.
  const preconditions = [
    ...setupFiles.filter((file): file is string => typeof file === 'string' && existsSync(resolve(root, file))),
    ...(options.preconditions ?? []),
  ].map((file) => resolve(root, file));
  const reporter = selectionReporter(coverageFile, runDirectory, modules, root, preconditions);
  const reporters = config.test?.reporters === undefined ? ['default'] : array(config.test.reporters);

  return {
    ...config,
    plugins: [...array(config.plugins), plugin],
    test: {
      ...config.test,
      // First, so a setup file of the project's that loads an instrumented
      // module finds the counter factory its header resolves.
      setupFiles: [setupId, ...setupFiles],
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
  return {
    name: 'variance-authority:test-selection',
    enforce: 'post',
    // The setup module keeps its path as its id rather than taking a virtual
    // one. Vitest drops every setup file from the module cache by path before
    // each test file so setup runs again without isolation; a module cached
    // under another id would survive that and run once for the whole worker.
    resolveId: (id) => (id === setupId ? setupId : null),
    load: (id) => (id === setupId ? setupSource(runDirectory) : null),
    transform(code, id) {
      // The setup module installs the counter factory; instrumented, its own
      // header would ask for the factory before the module has installed it.
      if (id === setupId) return null;
      const file = cleanId(id);
      if (!include(file)) return null;
      const lineOf = sourceLines(code, priorMap(this), file);
      // The digest is of the text on disk, which is what the block lines are
      // coordinates in once the prior transforms' maps are read back through;
      // `code` here is what those transforms made of it.
      const sourceDigest = digestOfFile(file, code);

      const done = instrument(code, file);
      if (done === undefined) {
        modules.set(file, {
          file: projectPath(root, file),
          sourceDigest,
          instrumented: false,
          blocks: [],
        });
        return null;
      }

      modules.set(file, {
        file: projectPath(root, file),
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
  runDirectory: string,
  modules: ReadonlyMap<string, CapturedModule>,
  root: string,
  preconditionFiles: readonly string[],
): Reporter {
  return {
    async onFinished(files) {
      const journals = await readJournals(runDirectory);
      const observed = crossingsOf(journals.map((journal) => ({
        testFile: projectPath(root, journal.testFile),
        modules: journal.modules.map((module) => ({ ...module, file: projectPath(root, module.file) })),
      })));

      const tests = await Promise.all(
        files.flatMap((file) => file.filepath === undefined
          ? []
          : [coverageTest(file, root, preconditionFiles, journals, modules)]),
      );
      const commit = await commitOf(root);
      const current: TestCoverage = {
        version: 3,
        instrumentation: INSTRUMENTATION_ID,
        ...(commit === undefined ? {} : { commit }),
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
      await writeTestCoverage(
        coverageFile,
        mergeCoverage(previous, current, await digestsOnDisk(root, previous, current)),
      );
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
// A module \`vi.resetModules\` evaluates again resolves this again, and keeps
// what it counted before the reset: same name and block count, same counters.
globalThis.__VA__ = (file, count) => {
  let counters = modules.get(file);
  if (counters === undefined || counters.length !== count) {
    counters = new Uint32Array(count);
    modules.set(file, counters);
  }
  return counters;
};
afterAll(async () => {
  const testFile = expect.getState().testPath;
  if (!testFile) throw new Error('variance-authority could not identify the current Vitest file');
  const journal = { testFile, modules: [...modules].map(([file, counters]) => ({
    file,
    hits: [...counters].flatMap((count, ordinal) => count === 0 ? [] : [ordinal]),
    shared: [...counters].flatMap((count, ordinal) => count >= ${EVALUATING} ? [ordinal] : []),
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


/** The digest of the file's text, or of `code` when the id is not a file on disk. */
function digestOfFile(file: string, code: string): string {
  try {
    return digestString(readFileSync(file, 'utf8'));
  } catch {
    return digestString(code);
  }
}

function array<T>(value: T | readonly T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? [...value] : [value as T];
}

export { mergeCoverage } from './merge.js';
