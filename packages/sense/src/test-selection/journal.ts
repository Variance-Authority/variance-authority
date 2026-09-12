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
 * 1. **The plugin** ({@link testSelectionProbes}, next door in `probes.ts` with
 *    the rest of the build half) belongs in the adopter's own build — a
 *    Storybook `viteFinal`, an application dev server. It instruments
 *    product source, hoists a collector in front of it, and writes each module's
 *    block record down under the id it instrumented that module with, for a run
 *    that has not started yet.
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
 * that also read it are not selected. So every region entered while a module
 * was evaluating — its root, a helper the top level called — is attributed to
 * **every subject the run drained**, over-including in the direction
 * [`selecting.md`](../../../../docs/selecting.md) already argues for. The page
 * marks those regions itself ([`instrument`](../instrument/index.ts)); the
 * join only reads the mark.
 */

import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { digestString } from '../digest.js';
import { INSTRUMENTATION_ID, type ModuleId } from '../instrument/index.js';
import { nameModules } from '../module-names.js';
import { commitOf } from './commit.js';
import { layeredCoverage } from './format-layer.js';
import {
  codeUnitOrder,
  coverageModule,
  idOrder,
  isMissing,
  moduleNamesFile,
  projectPath,
  readRecords,
  recordStore,
} from './instrumented-modules.js';
import {
  testCoverageFile,
  type CoveragePrecondition,
  type CoverageTest,
  type TestCoverage,
} from './index.js';
import {
  EXECUTION_GLOBAL,
  type ExecutionCollector,
  type ExecutionJournal,
} from './probes.js';

export {
  EXECUTION_GLOBAL,
  executionCollectorSource,
  testSelectionProbes,
  type ExecutedModule,
  type ExecutionCollector,
  type ExecutionJournal,
  type InstrumentingPlugin,
  type TestSelectionProbeOptions,
  type TransformingContext,
} from './probes.js';

/** What a module reports itself as, for a driver that writes its own journal. */
export type { ModuleId };


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
  /**
   * Where the record stores live. Defaults to the user cache.
   *
   * Matches {@link testSelectionProbes}'s `cacheRoot`, and is worth setting only
   * to keep one run's records out of the cache another run reads.
   */
  readonly cacheRoot?: string;
  /** Matches {@link testSelectionProbes}'s `label`. Defaults to `build`. */
  readonly label?: string;
  /** Persisted coverage index. Defaults to the repository-keyed user cache. */
  readonly coverageFile?: string;
  /**
   * Other builds this same run drove, by the label each instrumented under.
   *
   * Their stores join this call rather than getting one of their own, because a
   * second call describing the same subjects looks to the merge like a second
   * run and retires the first's evidence for every owner they share. Where two
   * stores hold one module and disagree about the text it was cut from, that
   * module is recorded as **not instrumented** — the builds transformed it
   * differently, so no ordinal in it means one thing, and unknown widens where
   * a guess would skip.
   */
  readonly heads?: readonly string[];
  /**
   * Where this recording stands. Defaults to the checkout's `HEAD`, which is the
   * answer in every case except a caller that already knows better.
   */
  readonly commit?: string;
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
 * Join drained journals to the block records they name and merge them into the index.
 *
 * A journal reports ids, and the id is what the join is: every module the page
 * entered says which record describes it, so the driver asks the stores for
 * those and nothing else. No build has to have ended, and no process ever holds
 * a module it did not instrument.
 *
 * It refuses in one direction only. A reported module no store can identify, a
 * record from another probe recipe, a journal from a page whose collector
 * predates this driver — each records nothing and says so, which costs the next
 * run its full suite. The opposite failure, half a journal written as though it
 * were whole, is what would silently skip a subject.
 */
export async function recordExecution(
  options: RecordExecutionOptions,
): Promise<ExecutionRecord> {
  const root = resolve(options.root);
  // One row per owner before anything reads them. A subject is read again
  // whenever the first read was not trusted — `again` before `alone` — so a
  // changed or unstable subject reaches here twice, and `tests` is keyed by
  // owner: two rows for one owner is the duplicate the encoder refuses to
  // intern. `joinObservations` is the fold that already exists for joining a
  // page to its heads, it is idempotent, and doing it here rather than in each
  // collector is what makes the invariant hold for collectors not yet written.
  const subjects = joinObservations([options.subjects]);
  const coverageFile =
    options.coverageFile === undefined
      ? testCoverageFile(root)
      : resolve(root, options.coverageFile);
  const stores = [...new Set(
    [options.label, ...(options.heads ?? [])].map((label) =>
      recordStore(root, label, options.cacheRoot),
    ),
  )];

  // Only the modules the journals name. A module nothing entered this run keeps
  // whatever the index already says about it, which is the merge's job and not
  // this call's, and asking the store for the rest would be reading a whole
  // build back out of a place that never holds one.
  const ids = new Set(
    subjects.flatMap((subject) => subject.journal.modules.map((module) => module.id)),
  );
  const byId = await readRecords(stores, ids);
  if (ids.size > 0 && byId.size === 0) {
    return {
      recorded: false,
      coverageFile,
      subjects: 0,
      because:
        `no source identity for any of the ${ids.size} modules the run reported, in ` +
        `${stores.join(', ')}: add \`testSelectionProbes()\` to the build this run drives, ` +
        'and build it with the same version of this package',
    };
  }

  const foreign = subjects.find(
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

  const owners = subjects.map((subject) => subject.owner);

  // What a module entered while evaluating — once per page, in whichever
  // subject's window it was first needed — is every subject's.
  const everyOwner = new Set<string>(owners);
  const crossings = new Map<ModuleId, Map<number, Set<string>>>();
  const entered = new Map<string, Set<ModuleId>>();

  for (const subject of subjects) {
    for (const module of subject.journal.modules) {
      const known = byId.get(module.id);
      if (known === undefined || !known.instrumented) continue;
      const evaluating = new Set(module.shared);
      const byOrdinal = crossings.get(module.id) ?? new Map<number, Set<string>>();
      for (const ordinal of module.hits) {
        const holders = byOrdinal.get(ordinal) ?? new Set<string>();
        if (evaluating.has(ordinal)) for (const owner of everyOwner) holders.add(owner);
        else holders.add(subject.owner);
        byOrdinal.set(ordinal, holders);
      }
      crossings.set(module.id, byOrdinal);
      const modulesOfSubject = entered.get(subject.owner) ?? new Set<ModuleId>();
      modulesOfSubject.add(module.id);
      entered.set(subject.owner, modulesOfSubject);
    }
  }

  const tests: readonly CoverageTest[] = subjects
    .map((subject): CoverageTest => {
      // A module whose record no store holds is evidence this driver cannot
      // read: its ordinals name regions nobody can point at, so they are
      // dropped. What may not be dropped is that the subject entered
      // *something* unaccounted for — recorded as complete, it would be a
      // subject with no crossings there, which is the shape of a skip. It is
      // recorded incomplete instead, and a later run reads it again.
      const whole =
        (subject.complete ?? true) &&
        subject.journal.modules.every((module) => byId.has(module.id));
      const digests = [...(entered.get(subject.owner) ?? [])]
        .map((id) => byId.get(id)!)
        .map((record) => ({ name: record.file, digest: record.sourceDigest }))
        .sort((left, right) => codeUnitOrder(left.name, right.name));
      return {
        file: subject.owner,
        complete: whole,
        preconditions: [...(subject.preconditions ?? []), ...digests],
      };
    })
    .sort((left, right) => codeUnitOrder(left.file, right.file));

  const commit = options.commit ?? (await commitOf(root));
  const current: TestCoverage = {
    version: 3,
    instrumentation: INSTRUMENTATION_ID,
    ...(commit === undefined ? {} : { commit }),
    tests,
    modules: [...byId]
      .map(([id, module]) =>
        coverageModule(module, (block) => [...(crossings.get(id)?.get(block.ordinal) ?? [])]),
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
    const temporary = `${coverageFile}.${process.pid}-${randomUUID()}.tmp`;
    await writeFile(temporary, await layeredCoverage(coverageFile, current, root));
    await rename(temporary, coverageFile);
    // Every module this run could identify, numbered for the next one. A file
    // first met today was instrumented under its path; from here on it has a
    // number, and the transform that emits it needs to consult nothing. Under
    // the same lock as the merge: the table is read-modify-write too, and two
    // folds appending at once would each read the same `count` and hand one
    // number to two paths.
    await nameModules(
      moduleNamesFile(root, options.cacheRoot),
      [...byId.values()].map((module) => module.file),
    );
  } finally {
    await rm(lock, { force: true });
  }

  return { recorded: true, coverageFile, subjects: subjects.length };
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
 * One row per owner, whatever realm saw it.
 *
 * A run records once. Two calls describing the same subject are two runs as far
 * as the merge is concerned, and the second retires the first — so a page's
 * crossings and every head's are one observation before anything is written.
 */
export function joinObservations(
  sources: readonly (readonly ObservedSubject[])[],
): readonly ObservedSubject[] {
  interface Held {
    readonly modules: Map<ModuleId, Set<number>>;
    readonly shared: Map<ModuleId, Set<number>>;
    readonly preconditions: Map<string, CoveragePrecondition>;
    complete: boolean;
    instrumentation: string;
  }
  const byOwner = new Map<string, Held>();
  const union = (into: Map<ModuleId, Set<number>>, id: ModuleId, ordinals: readonly number[]): void => {
    into.set(id, new Set([...(into.get(id) ?? []), ...ordinals]));
  };

  for (const subjects of sources) {
    for (const subject of subjects) {
      const held = byOwner.get(subject.owner) ?? {
        modules: new Map<ModuleId, Set<number>>(),
        shared: new Map<ModuleId, Set<number>>(),
        preconditions: new Map<string, CoveragePrecondition>(),
        complete: true,
        instrumentation: INSTRUMENTATION_ID,
      };
      for (const module of subject.journal.modules) {
        union(held.modules, module.id, module.hits);
        union(held.shared, module.id, module.shared);
      }
      for (const precondition of subject.preconditions ?? []) {
        held.preconditions.set(precondition.name, precondition);
      }
      if (subject.complete === false) held.complete = false;
      // A recipe that does not match this driver's has to survive the fold, or
      // the refusal it exists to trigger is folded away with it.
      if (subject.journal.instrumentation !== INSTRUMENTATION_ID) {
        held.instrumentation = subject.journal.instrumentation;
      }
      byOwner.set(subject.owner, held);
    }
  }

  return [...byOwner]
    .sort(([left], [right]) => codeUnitOrder(left, right))
    .map(([owner, held]) => ({
      owner,
      complete: held.complete,
      journal: {
        instrumentation: held.instrumentation,
        modules: [...held.modules]
          .map(([id, ordinals]) => ({
            id,
            hits: [...ordinals].sort((a, b) => a - b),
            shared: [...(held.shared.get(id) ?? [])].sort((a, b) => a - b),
          }))
          .sort((left, right) => idOrder(left.id, right.id)),
      },
      ...(held.preconditions.size === 0
        ? {}
        : { preconditions: [...held.preconditions.values()] }),
    }));
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

