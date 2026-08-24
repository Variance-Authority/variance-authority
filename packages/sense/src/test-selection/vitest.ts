import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { Reporter } from 'vitest/reporters';
import type { UserConfig } from 'vitest/config';
import { instrument, type Block } from '../instrument/index.js';
import { decodeTestCoverage, encodeTestCoverage } from './format.js';
import { testCoverageFile, type CoverageBlock, type CoverageModule, type TestCoverage } from './index.js';

export interface TestSelectionOptions {
  /** Repository root. Defaults to the Vitest config root, then the current directory. */
  readonly root?: string;
  /** Persisted coverage index. Defaults to the repository-keyed user cache. */
  readonly coverageFile?: string;
  /** Decide which transformed modules are product source. */
  readonly include?: (file: string) => boolean;
}

interface VitePlugin {
  readonly name: string;
  readonly enforce: 'post';
  readonly resolveId: (id: string) => string | null;
  readonly load: (id: string) => string | null;
  readonly transform: (code: string, id: string) => { code: string; map: null } | null;
}

interface CapturedModule {
  readonly file: string;
  readonly blocks: readonly CoverageBlock[];
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
  const reporter = selectionReporter(coverageFile, runDirectory, modules, root);
  const setupFiles = array(config.test?.setupFiles);
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
      if (done === undefined) return null;

      modules.set(file, {
        file: projectPath(root, file),
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
): Reporter {
  return {
    async onFinished(files) {
      const passed = new Set(files.filter(filePassed).map((file) => projectPath(root, file.filepath)));
      const journals = await readJournals(runDirectory);
      const observed = new Map<string, Map<number, Set<string>>>();

      for (const journal of journals) {
        const testFile = projectPath(root, journal.testFile);
        if (!passed.has(testFile)) continue;
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

      const current: TestCoverage = {
        version: 2,
        testFiles: [...passed].sort(codeUnitOrder),
        modules: [...modules.values()]
          .map((module): CoverageModule => ({
            file: module.file,
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

/** Merge independent runs and shards without discarding earlier observations. */
export function mergeCoverage(
  previous: TestCoverage | undefined,
  current: TestCoverage,
): TestCoverage {
  if (previous === undefined) return current;

  const currentFiles = new Map(current.modules.map((module) => [module.file, module]));
  const modules = current.modules.map((module): CoverageModule => {
    const old = previous.modules.find((candidate) => candidate.file === module.file);
    return {
      file: module.file,
      blocks: module.blocks.map((block) => {
        const before = old?.blocks.find(
          (candidate) => candidate.name === block.name && candidate.path === block.path,
        );
        return {
          ...block,
          testFiles: [...new Set([...(before?.testFiles ?? []), ...block.testFiles])].sort(codeUnitOrder),
        };
      }),
    };
  });
  for (const module of previous.modules) {
    if (!currentFiles.has(module.file)) modules.push(module);
  }
  modules.sort((left, right) => codeUnitOrder(left.file, right.file));
  return {
    version: 2,
    testFiles: [...new Set([...previous.testFiles, ...current.testFiles])].sort(codeUnitOrder),
    modules,
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

function coverageBlock(source: string, block: Block): CoverageBlock {
  return {
    ordinal: block.ordinal,
    kind: block.kind,
    name: block.name,
    path: block.path,
    startLine: lineAt(source, block.start),
    endLine: lineAt(source, block.end > block.start ? block.end - 1 : block.end),
    source: block.end > block.start,
    testFiles: [],
  };
}

function lineAt(source: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

function filePassed(file: RunnerTask): boolean {
  const failed = (task: RunnerTask): boolean =>
    task.result?.state === 'fail' || task.tasks?.some(failed) === true;
  return !failed(file);
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

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function cleanId(id: string): string {
  return id.split('?')[0] ?? id;
}

function defaultInclude(file: string): boolean {
  return (
    isAbsolute(file) &&
    /\.[cm]?[jt]sx?$/.test(file) &&
    !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file) &&
    !file.split(sep).includes('node_modules') &&
    !file.split(sep).includes('dist')
  );
}

function projectPath(root: string, file: string): string {
  return relative(root, file).split(sep).join('/');
}

function array<T>(value: T | readonly T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? [...value] : [value as T];
}

function codeUnitOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
