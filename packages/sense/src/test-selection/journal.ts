/**
 * `@variance-authority/sense/journal` — the same instrument, over a wire.
 *
 * [Spec 0028](../../../../docs/specs/0028-the-instrument.md) states the rule this
 * file discharges: *a browser needs a different transport, not a different
 * instrument.* A browser is the case that exists, and not the boundary this
 * draws. What the Vitest seam has and this does not is a recorder that ran the
 * instrumentation itself: there, the transform, the counters and the runner's
 * task tree are one process, so the block names are in memory and the runner
 * says who was executing. Here the evidence is **reported** — the names live in
 * whichever process ran the bundler, the counters live wherever the code ran,
 * and a driver joins them. That realm is usually a page. Nothing below requires
 * it to be: a journal is a probe recipe and a list of ordinals, and the one
 * thing asked of a driver is that it can evaluate.
 *
 * Three parts, and each is somebody's:
 *
 * 1. **The plugin** ({@link testSelectionProbes}) belongs in the adopter's own
 *    build — a Storybook `viteFinal`, an application dev server. It instruments
 *    product source, hoists a collector in front of it, and writes the block
 *    inventory down for a run that has not started yet.
 * 2. **The collector** is a string, evaluated in the instrumented realm. No Node
 *    built-ins, no imports, no bundler assumptions — the same constraint that
 *    made the emitted runtime portable in the first place.
 * 3. **The join** ({@link recordExecution}) runs in the driver, once a subject
 *    has been observed, and turns *ordinals somebody else reported* into the
 *    coverage index every other consumer already reads.
 *
 * ## What a subject owns, and what it cannot
 *
 * A module's own initialization runs once per realm, for whichever subject
 * happened to be first. Attributing it to that subject would be a lie the shape
 * of a skipped test: edit a top-level constant and the three hundred stories
 * that also read it are not selected. So module-kind blocks are attributed to
 * **every subject the run drained** — over-including, in the direction
 * [`selecting.md`](../../../../docs/selecting.md) already argues for, and
 * without pretending a page can tell which story caused a module to evaluate.
 */

import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { digestString } from '@variance-authority/core';
import { INSTRUMENTATION_ID, instrument } from '../instrument/index.js';
import { decodeTestCoverage, encodeTestCoverage } from './format.js';
import { mergeCoverage } from './merge.js';
import {
  cleanId,
  codeUnitOrder,
  coverageBlock,
  coverageModule,
  defaultInclude,
  instrumentedModulesFile,
  isMissing,
  projectPath,
  readInstrumentedModules,
  writeInstrumentedModules,
  type CapturedModule,
} from './instrumented-modules.js';
import {
  testCoverageFile,
  type CoveragePrecondition,
  type CoverageTest,
  type TestCoverage,
} from './index.js';

/**
 * Where a page hands its journal over.
 *
 * Deliberately not a short name: this shares a global namespace with whatever
 * application the page already loaded, and a collision would be discovered as a
 * confusing selection rather than as an error.
 */
export const EXECUTION_GLOBAL = '__variance_authority_execution__';

/** What one module reported: the ordinals it entered, deduplicated. */
export interface ExecutedModule {
  readonly file: string;
  readonly hits: readonly number[];
}

/** Everything a page entered between two drains. */
export interface ExecutionJournal {
  readonly instrumentation: string;
  readonly modules: readonly ExecutedModule[];
}

/** What the collector exposes on {@link EXECUTION_GLOBAL}. */
export interface ExecutionCollector {
  readonly version: 1;
  readonly instrumentation: string;
  /** Everything entered since the previous drain. Zeroes the counters. */
  readonly drain: () => ExecutionJournal;
  /** Forget everything entered so far without reporting it. */
  readonly reset: () => void;
}

export interface TestSelectionProbeOptions {
  /** Repository root. Defaults to the current directory. */
  readonly root?: string;
  /** Decide which transformed modules are product source. */
  readonly include?: (file: string) => boolean;
  /**
   * Separates two bundlers over one repository. Defaults to `build`.
   *
   * A Storybook preview and the application a Playwright suite drives are
   * different builds of overlapping source; one label for both would answer a
   * block ordinal with whichever build wrote its inventory last.
   */
  readonly label?: string;
  /** Persisted block inventory. Defaults to the repository-keyed user cache. */
  readonly modulesFile?: string;
}

/** The subset of Vite's plugin surface this uses, so nothing here needs Vite. */
export interface InstrumentingPlugin {
  readonly name: string;
  readonly enforce: 'post';
  readonly resolveId: (id: string) => string | null;
  readonly load: (id: string) => string | null;
  readonly transform: (code: string, id: string) => { code: string; map: null } | null;
  readonly buildEnd: () => Promise<void>;
  readonly closeBundle: () => Promise<void>;
}

const VIRTUAL_COLLECTOR = 'variance-authority:execution-collector';
const RESOLVED_COLLECTOR = `\0${VIRTUAL_COLLECTOR}`;

/**
 * Instrument a build and write down what its ordinals mean.
 *
 * ```js
 * // .storybook/main.js
 * import { testSelectionProbes } from '@variance-authority/sense/journal';
 *
 * export default {
 *   viteFinal: (config) => ({
 *     ...config,
 *     plugins: [...config.plugins, testSelectionProbes({ label: 'storybook' })],
 *   }),
 * };
 * ```
 *
 * `enforce: 'post'` for the reason the Vitest seam has it: probes land on JS
 * after TypeScript is stripped, so nothing here parses a syntax `oxc` would have
 * to be taught.
 */
export function testSelectionProbes(
  options: TestSelectionProbeOptions = {},
): InstrumentingPlugin {
  const root = resolve(options.root ?? process.cwd());
  const file =
    options.modulesFile === undefined
      ? instrumentedModulesFile(root, options.label)
      : resolve(root, options.modulesFile);
  const include = options.include ?? defaultInclude;
  const modules = new Map<string, CapturedModule>();
  let written: Promise<void> = Promise.resolve();

  // Written as the build proceeds rather than only at its end, because a dev
  // server has no end: a Playwright suite drives a server that transforms
  // modules for the whole life of the run, and a driver draining the page needs
  // the inventory for what it just executed, not for what a build finished with.
  const persist = (): void => {
    written = written.then(() => writeInstrumentedModules(file, [...modules.values()]));
  };

  return {
    name: 'variance-authority:test-selection-probes',
    enforce: 'post',
    resolveId: (id) => (id === VIRTUAL_COLLECTOR || id === RESOLVED_COLLECTOR ? RESOLVED_COLLECTOR : null),
    load: (id) => (id === RESOLVED_COLLECTOR ? executionCollectorSource() : null),

    transform(code, id) {
      const source = cleanId(id);
      if (source === RESOLVED_COLLECTOR || !include(source)) return null;

      // Instrumented under its repository-relative name, which is what the page
      // then reports. A journal that named absolute paths would be a journal
      // from the build machine's disk — unreadable on a driver that mounted the
      // checkout somewhere else, and a leak of a layout nobody asked for.
      const file = projectPath(root, source);
      const done = instrument(code, file);
      if (done === undefined) {
        modules.set(source, {
          file,
          sourceDigest: digestString(code),
          instrumented: false,
          blocks: [],
        });
        persist();
        return null;
      }

      modules.set(source, {
        file,
        sourceDigest: done.sourceDigest,
        instrumented: true,
        blocks: done.blocks.map((block) => coverageBlock(code, block)),
      });
      persist();

      // Hoisted in front of everything the module imports, and on the first line,
      // so line numbers survive the way every other insertion in this package
      // preserves them. An instrumented module whose collector arrived late would
      // throw at its own module probe.
      return { code: `import ${JSON.stringify(VIRTUAL_COLLECTOR)};${done.code}`, map: null };
    },

    async buildEnd(): Promise<void> {
      persist();
      await written;
    },

    async closeBundle(): Promise<void> {
      await written;
    },
  };
}

/**
 * The page half, as source, because it has to cross `page.evaluate` or a bundler.
 *
 * `globalThis.__VA__` keeps its identity for the life of the page: the emitted
 * probe caches its counter array and re-resolves only when the factory changes,
 * so a reset that replaced the factory would cost every module a re-registration
 * — and a module that never runs again would never re-register at all.
 */
export function executionCollectorSource(): string {
  return `
const modules = new Map();
const factory = (file, count) => {
  let counters = modules.get(file);
  if (counters === undefined || counters.length !== count) {
    counters = new Uint32Array(count);
    modules.set(file, counters);
  }
  return counters;
};
globalThis.__VA__ = factory;
globalThis[${JSON.stringify(EXECUTION_GLOBAL)}] = {
  version: 1,
  instrumentation: ${JSON.stringify(INSTRUMENTATION_ID)},
  drain() {
    const entered = [];
    for (const [file, counters] of modules) {
      const hits = [];
      for (let ordinal = 0; ordinal < counters.length; ordinal += 1) {
        if (counters[ordinal] > 0) {
          hits.push(ordinal);
          counters[ordinal] = 0;
        }
      }
      if (hits.length > 0) entered.push({ file, hits });
    }
    return { instrumentation: ${JSON.stringify(INSTRUMENTATION_ID)}, modules: entered };
  },
  reset() {
    for (const counters of modules.values()) counters.fill(0);
  },
};
`;
}

/** The one thing a driver has to be able to do, so nothing here imports a driver. */
export interface EvaluatingPage {
  evaluate<Result, Argument>(
    body: (argument: Argument) => Result,
    argument: Argument,
  ): Promise<Result>;
}

/**
 * Take everything the page entered since the last drain.
 *
 * `undefined` means the page has no collector — an application built without
 * {@link testSelectionProbes}, which is the ordinary case and not an error.
 * The distinction is kept here rather than defaulted to an empty journal,
 * because "recorded nothing" and "recorded that nothing ran" are the two facts a
 * later selection must never confuse.
 */
export async function drainExecution(page: EvaluatingPage): Promise<ExecutionJournal | undefined> {
  return page.evaluate((global: string) => {
    const collector = (globalThis as unknown as Record<string, ExecutionCollector | undefined>)[
      global
    ];
    return collector === undefined ? undefined : collector.drain();
  }, EXECUTION_GLOBAL);
}

/** One subject's window in the page, as the driver observed it. */
export interface ObservedSubject {
  /**
   * Who the crossings belong to: a subject id for a story, a test file for a
   * Playwright page.
   *
   * Spec 0028 divides these on purpose. Storybook is an execution surface this
   * tool owns, so a story may be selected individually; a Playwright page
   * crossing joins the test file the runner would have to execute anyway.
   */
  readonly owner: string;
  readonly journal: ExecutionJournal;
  /**
   * Inputs whose identity this observation depended on: the story file, the
   * spec file, a fixture. A changed precondition retires the observation rather
   * than aging it, and a changed file that no module answers for selects every
   * observation it governs.
   */
  readonly preconditions?: readonly CoveragePrecondition[];
  /**
   * False when the subject did not finish — a story that never rendered, a test
   * that failed. An incomplete observation contributes crossings and may never
   * justify an exclusion.
   */
  readonly complete?: boolean;
}

export interface RecordExecutionOptions {
  /** Repository root the paths in the inventory are relative to. */
  readonly root: string;
  readonly subjects: readonly ObservedSubject[];
  /** Defaults to the label's repository-keyed inventory. */
  readonly modulesFile?: string;
  /** Matches {@link testSelectionProbes}'s `label`. Defaults to `build`. */
  readonly label?: string;
  /** Persisted coverage index. Defaults to the repository-keyed user cache. */
  readonly coverageFile?: string;
}

/** What a run learned, or why it learned nothing. */
export interface ExecutionRecord {
  readonly recorded: boolean;
  /** Present when nothing was recorded, in the words a report can print. */
  readonly because?: string;
  readonly coverageFile: string;
  readonly subjects: number;
}

/**
 * Join drained journals to the block inventory and merge them into the index.
 *
 * It refuses in one direction only. A missing inventory, an inventory from
 * another probe recipe, a journal from a page whose collector predates this
 * driver — each records nothing and says so, which costs the next run its full
 * suite. The opposite failure, half a journal written as though it were whole,
 * is what would silently skip a subject.
 */
export async function recordExecution(
  options: RecordExecutionOptions,
): Promise<ExecutionRecord> {
  const root = resolve(options.root);
  const coverageFile =
    options.coverageFile === undefined
      ? testCoverageFile(root)
      : resolve(root, options.coverageFile);
  const modulesFile =
    options.modulesFile === undefined
      ? instrumentedModulesFile(root, options.label)
      : resolve(root, options.modulesFile);

  const inventory = await readInstrumentedModules(modulesFile);
  if (inventory === undefined) {
    return {
      recorded: false,
      coverageFile,
      subjects: 0,
      because:
        `no instrumented block inventory at ${modulesFile}: add ` +
        '`testSelectionProbes()` to the build this run drives, and rebuild it with ' +
        'the same version of this package',
    };
  }

  const foreign = options.subjects.find(
    (subject) => subject.journal.instrumentation !== INSTRUMENTATION_ID,
  );
  if (foreign !== undefined) {
    return {
      recorded: false,
      coverageFile,
      subjects: 0,
      because:
        `the page reported probe recipe ${foreign.journal.instrumentation} and this driver ` +
        `records ${INSTRUMENTATION_ID}: the build and the driver are different versions`,
    };
  }

  const byFile = new Map(inventory.modules.map((module) => [module.file, module]));
  const owners = options.subjects.map((subject) => subject.owner);

  // Module initialization runs once per page, for whichever subject was first.
  // It is every subject's, and this is the line that says so.
  const shared = new Set<string>(owners);
  const crossings = new Map<string, Map<number, Set<string>>>();
  const entered = new Map<string, Set<string>>();

  for (const subject of options.subjects) {
    for (const module of subject.journal.modules) {
      const known = byFile.get(module.file);
      if (known === undefined || !known.instrumented) continue;
      const kinds = new Map(known.blocks.map((block) => [block.ordinal, block.kind]));
      const byOrdinal = crossings.get(module.file) ?? new Map<number, Set<string>>();
      for (const ordinal of module.hits) {
        const holders = byOrdinal.get(ordinal) ?? new Set<string>();
        if (kinds.get(ordinal) === 'module') for (const owner of shared) holders.add(owner);
        else holders.add(subject.owner);
        byOrdinal.set(ordinal, holders);
      }
      crossings.set(module.file, byOrdinal);
      const modulesOfSubject = entered.get(subject.owner) ?? new Set<string>();
      modulesOfSubject.add(module.file);
      entered.set(subject.owner, modulesOfSubject);
    }
  }

  const tests: readonly CoverageTest[] = options.subjects
    .map((subject): CoverageTest => {
      const digests = [...(entered.get(subject.owner) ?? [])]
        .sort(codeUnitOrder)
        .map((file) => ({ name: file, digest: byFile.get(file)!.sourceDigest }));
      return {
        file: subject.owner,
        complete: subject.complete ?? true,
        preconditions: [...(subject.preconditions ?? []), ...digests],
      };
    })
    .sort((left, right) => codeUnitOrder(left.file, right.file));

  const current: TestCoverage = {
    version: 2,
    instrumentation: INSTRUMENTATION_ID,
    tests,
    modules: inventory.modules
      .map((module) =>
        coverageModule(module, (block) => [
          ...(crossings.get(module.file)?.get(block.ordinal) ?? []),
        ]),
      )
      .sort((left, right) => codeUnitOrder(left.file, right.file)),
  };

  // Read-modify-write, and more than one process does it. A Playwright suite
  // runs its workers as separate processes over one index, so the exclusion is
  // between processes or it is nothing: two unlocked workers would each merge
  // against the index they read at the start and the later rename would drop the
  // earlier worker's whole contribution — silently, and in the unsafe direction.
  await mkdir(dirname(coverageFile), { recursive: true });
  const lock = await takeIndexLock(coverageFile);
  if (lock === undefined) {
    return {
      recorded: false,
      coverageFile,
      subjects: 0,
      because:
        `another process is holding ${coverageFile}.lock: nothing was recorded rather ` +
        'than merged over whatever it is writing',
    };
  }
  try {
    const previous = await existingCoverage(coverageFile);
    const temporary = `${coverageFile}.${process.pid}-${randomUUID()}.tmp`;
    await writeFile(temporary, encodeTestCoverage(mergeCoverage(previous, current)));
    await rename(temporary, coverageFile);
  } finally {
    await rm(lock, { force: true });
  }

  return { recorded: true, coverageFile, subjects: options.subjects.length };
}

/**
 * Hold the index for one merge, or give up.
 *
 * `wx` is the exclusion — one creator wins on every filesystem this runs on —
 * and the waiting is bounded because a crashed holder must not make every later
 * run hang. A lock older than {@link LOCK_STALE_MS} is treated as abandoned and
 * broken: the cost of breaking one that was merely slow is a lost contribution,
 * which is a wider next run, and the cost of never breaking it is a suite that
 * stops recording until somebody deletes a file by hand.
 */
async function takeIndexLock(coverageFile: string): Promise<string | undefined> {
  const lock = `${coverageFile}.lock`;
  const deadline = LOCK_WAIT_MS / LOCK_POLL_MS;
  for (let attempt = 0; attempt <= deadline; attempt += 1) {
    try {
      await writeFile(lock, `${process.pid}\n`, { flag: 'wx' });
      return lock;
    } catch (error) {
      if (!isTaken(error)) throw error;
      const age = await lockAge(lock);
      if (age !== undefined && age > LOCK_STALE_MS) {
        await rm(lock, { force: true });
        continue;
      }
      await new Promise((wake) => setTimeout(wake, LOCK_POLL_MS));
    }
  }
  return undefined;
}

const LOCK_WAIT_MS = 10_000;
const LOCK_POLL_MS = 25;
const LOCK_STALE_MS = 60_000;

async function lockAge(lock: string): Promise<number | undefined> {
  try {
    return Date.now() - (await stat(lock)).mtimeMs;
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

function isTaken(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}

/**
 * Read the file digest of one precondition, repository-relative.
 *
 * A story file and a spec file are the two this exists for: nothing *enters*
 * them, so no module row answers for them, and without a precondition a commit
 * that edits one selects nothing at all.
 */
export async function preconditionOf(
  root: string,
  file: string,
): Promise<CoveragePrecondition | undefined> {
  try {
    return {
      name: projectPath(resolve(root), resolve(root, file)),
      digest: digestString(await readFile(resolve(root, file), 'utf8')),
    };
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

async function existingCoverage(file: string): Promise<TestCoverage | undefined> {
  try {
    return decodeTestCoverage(await readFile(file));
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}
