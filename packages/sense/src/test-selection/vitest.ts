import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, readdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { digestString } from '../digest.js';
import type { Reporter } from 'vitest/reporters';
import type { UserConfig } from 'vitest/config';
import { instrument, instrumentationId, type InstrumentMode, type ModuleId } from '../instrument/index.js';
import { nameModules, readModuleNames, type ModuleNames } from '../module-names.js';
import journalFormat from './journal-format.cjs';
import { priorMap, type TransformingContext } from './probes.js';
import { commitOf } from './commit.js';
import { layeredCoverage } from './format-layer.js';
import {
  cleanId,
  codeUnitOrder,
  coverageBlock,
  coverageModule,
  crossingsOf,
  defaultInclude,
  isMissing,
  loadedOf,
  moduleNamesFile,
  projectPath,
  type CapturedModule,
  type ReadJournal,
} from './instrumented-modules.js';
import { sourceLines } from './source-lines.js';
import {
  testCoverageFile,
  writeCoverageBytes,
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
  /**
   * `presence` probes every arrival region; `entries` probes modules and
   * functions only, and costs a fraction of it. Both record which functions
   * ran before the file's first test.
   */
  readonly mode?: InstrumentMode;
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
  const modules = new Map<ModuleId, CapturedModule>();
  const include = options.include ?? defaultInclude;
  // Once per process, before any module is transformed: the table this run
  // reads is the one the last fold published, and this run's own fold grows it.
  const names = readModuleNames(moduleNamesFile(root));
  const mode = options.mode ?? 'presence';
  const plugin = selectionPlugin(root, runDirectory, setupId, modules, include, names, mode);
  const setupFiles = array(config.test?.setupFiles);
  // A setup entry may be a package — `dotenv/config` — rather than a file of
  // the project's; a package is no precondition a diff can carry, and read as a
  // path it is a missing file that fails the reporter and loses the snapshot.
  const preconditions = [
    ...setupFiles.filter((file): file is string => typeof file === 'string' && existsSync(resolve(root, file))),
    ...(options.preconditions ?? []),
  ].map((file) => resolve(root, file));
  const reporter = selectionReporter(coverageFile, runDirectory, modules, root, preconditions, mode);
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
  modules: Map<ModuleId, CapturedModule>,
  include: (file: string) => boolean,
  names: ModuleNames,
  mode: InstrumentMode,
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

      // Under its id, the same one every other seam instruments under, so a
      // journal reads the same whoever produced it. Vitest re-transforms every
      // run in this process, so the records stay in this map rather than going
      // to the store a build needs — writing two hundred thousand files to read
      // them back a second later is ceremony, not durability.
      const name = projectPath(root, file);
      const moduleId = names.idOf(name) ?? name;
      const done = instrument(code, name, moduleId, { mode });
      if (done === undefined) {
        modules.set(moduleId, { file: name, id: moduleId, sourceDigest, instrumented: false, blocks: [] });
        return null;
      }

      modules.set(moduleId, {
        file: name,
        id: moduleId,
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
  modules: ReadonlyMap<ModuleId, CapturedModule>,
  root: string,
  preconditionFiles: readonly string[],
  mode: InstrumentMode,
): Reporter {
  return {
    async onFinished(files) {
      const journals = await readJournals(runDirectory);
      // A journal names modules by id, so nothing here re-keys paths; the id is
      // what the map is keyed by too.
      const rows = journals.map((journal) => ({
        testFile: projectPath(root, journal.testFile),
        modules: journal.modules,
      }));
      const observed = crossingsOf(rows);
      const early = loadedOf(rows);

      const tests = await Promise.all(
        files.flatMap((file) => file.filepath === undefined
          ? []
          : [coverageTest(file, root, preconditionFiles, journals, modules)]),
      );
      const commit = await commitOf(root);
      const current: TestCoverage = {
        version: 3,
        instrumentation: instrumentationId(mode),
        ...(commit === undefined ? {} : { commit }),
        tests: tests.sort((left, right) => codeUnitOrder(left.file, right.file)),
        modules: [...modules]
          .map(([id, module]): CoverageModule => coverageModule(
            module,
            (block) => [...(observed.get(id)?.get(block.ordinal) ?? [])],
            (block) => [...(early.get(id)?.get(block.ordinal) ?? [])],
          ))
          .sort((left, right) => codeUnitOrder(left.file, right.file)),
      };
      await writeCoverageBytes(coverageFile, await layeredCoverage(coverageFile, current, root));
      // Everything this run saw, numbered for the next one. A file first met
      // today was instrumented under its path; from here on it has a number.
      await nameModules(moduleNamesFile(root), [...modules.values()].map((module) => module.file));
      await rm(runDirectory, { recursive: true, force: true });
    },
  };
}

/**
 * This file, so the setup module can reach the codec beside it.
 *
 * The setup module is loaded by id through this plugin and has no directory of
 * its own to resolve a package name from, which leaves an absolute reference —
 * and it is taken with `createRequire` rather than an `import` because Vite
 * resolves every specifier a module it transforms names. A file under jsdom is
 * transformed in web mode, where an absolute `file:` URL is not a specifier
 * anything resolves, and the codec is CommonJS that has no business going
 * through a transform in either mode. `node:module` is a builtin, so the one
 * import the setup module keeps is one every runner already externalizes.
 */
const HERE = import.meta.url;

/**
 * The module every test file evaluates before itself: the counter factory, and
 * the handoff at the end.
 *
 * The counters go out as a frame through the same codec the Jest half uses, so
 * neither runner's journals are a shape the other does not read, and neither
 * worker builds a row per module to hand one over.
 */
function setupSource(runDirectory: string): string {
  return `
import { afterAll, beforeAll, expect } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const journalFormat = createRequire(${JSON.stringify(HERE)})('./journal-format.cjs');
const modules = new Map();
// A module \`vi.resetModules\` evaluates again resolves this again, and keeps
// what it counted before the reset: same name and block count, same counters.
globalThis.__VA__ = (id, count) => {
  let counters = modules.get(id);
  if (counters === undefined || counters.length !== count) {
    counters = new Uint32Array(count);
    modules.set(id, counters);
  }
  return counters;
};
// What had run before the file's first test. The file is collected — its
// imports evaluated, its top level run — before any hook runs, so a function
// counted here ran as a consequence of loading, not of a test.
const loaded = new Map();
beforeAll(() => {
  for (const [id, counters] of modules) loaded.set(id, counters.slice());
});
afterAll(async () => {
  const testFile = expect.getState().testPath;
  if (!testFile) throw new Error('variance-authority could not identify the current Vitest file');
  await mkdir(${JSON.stringify(runDirectory)}, { recursive: true });
  await writeFile(
    ${JSON.stringify(`${runDirectory}/`)} + process.pid + '-' + randomUUID() + '.va',
    journalFormat.encodeJournal(testFile, modules, loaded),
  );
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
  journals: readonly ReadJournal[],
  modules: ReadonlyMap<ModuleId, CapturedModule>,
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
      const module = modules.get(entered.id);
      if (module === undefined) {
        throw new Error(`variance-authority lost the source identity for module ${entered.id}`);
      }
      preconditions.push({ name: module.file, digest: module.sourceDigest });
    }
  }
  return { file, complete: fileComplete(task), preconditions };
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
