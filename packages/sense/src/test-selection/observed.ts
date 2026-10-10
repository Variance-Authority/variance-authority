/**
 * What a driver observed, and how two of them are one observation.
 *
 * Here rather than in `journal.ts` because the fold has more than one caller:
 * a run that records through one process joins a page to its heads, and a run
 * recorded by several joins the processes as well. Both are the same question
 * — two rows for one owner is a duplicate the encoder refuses to intern — and
 * an answer that lived beside either caller would be reimplemented beside the
 * other.
 */

import { INSTRUMENTATION_ID, type ModuleId } from '../instrument/index.js';
import { AMBIENT, type CaseJournal } from './cases.js';
import type { ObservedEyes } from './eyes-record.js';
import { codeUnitOrder } from './instrumented-modules.js';
import type { CoveragePrecondition } from './index.js';
import type { ExecutedModule, ExecutionJournal } from './probes.js';

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
  /**
   * Milliseconds the runner reported for this owner's tests in this source,
   * never a clock of the driver's. Absent from a source that timed nothing —
   * a head reports crossings, not time — so a join sums what its sources carry.
   */
  readonly duration?: number;
}

/**
 * One individual case's window, where the driver can tell them apart.
 *
 * A story is one of these for free — the driver shows it on its own — and a
 * Playwright test is one whenever the fixture drains at its teardown. The
 * module half is the same journal an {@link ObservedSubject} carries; what is
 * added is the coordinate, because the index names a case by where it is
 * declared and not by the runner's position for it.
 *
 * This is beside the snapshot and never inside it. The snapshot answers *which
 * files must run*, and a case is finer than anything a runner can be asked to
 * execute. It is also never free: a suite of a hundred thousand small cases
 * writes a hundred thousand rows nobody will ask about, which is why every seam
 * that can write one asks first.
 */
export interface ObservedCase {
  /** The file that declares the case, repository-relative. */
  readonly file: string;
  /** The declaration path inside that file. Never empty — empty is the ambient bucket. */
  readonly name: string;
  /** Unique within the run. Two drains under one id are one case read twice. */
  readonly id: string;
  /** {@link CaseCoordinate.project}: absent when the run names none. */
  readonly project?: string;
  /** {@link ExecutionTest.stopped}: absent when the driver cannot say how the case settled. */
  readonly stopped?: boolean;
  /** {@link ExecutionTest.duration}: the runner's milliseconds, summed over the attempts this source saw. */
  readonly duration?: number;
  /**
   * What the case said it arranged, as {@link CaseJournal.said}: sites named
   * from the checkout, absent where the driver never listened.
   */
  readonly said?: CaseJournal['said'];
  readonly journal: ExecutionJournal;
  /**
   * The Eyes journals the case handed over, one per attempt this source saw.
   * Absent when the case composed no Eyes, which is not the same as a journal
   * that recorded nothing.
   */
  readonly eyes?: readonly ObservedEyes[];
}

/**
 * What one owner entered, gathered across every window that fed it, kept apart
 * by the way each region was entered.
 *
 * Two windows of one owner are joined per way, never per list. A region one
 * window entered only while its module evaluated and another entered while
 * none did is a region the owner entered both ways, the same as one window
 * that entered it both ways ({@link ExecutedModule.again}). Joining `hits` and
 * `shared` alone reads it as entered while evaluating, and the owner loses the
 * call it made.
 */
export interface EnteredModules {
  readonly hits: Map<ModuleId, Set<number>>;
  /** Of `hits`, entered while a module was evaluating. */
  readonly shared: Map<ModuleId, Set<number>>;
  /** Of `hits`, entered while no module was evaluating. */
  readonly plain: Map<ModuleId, Set<number>>;
}

/** Nothing entered yet. */
export function enteredModules(): EnteredModules {
  return { hits: new Map(), shared: new Map(), plain: new Map() };
}

/** Fold one window's modules into what its owner entered. */
export function enterModules(entered: EnteredModules, modules: readonly ExecutedModule[]): void {
  const into = (held: Map<ModuleId, Set<number>>, id: ModuleId): Set<number> => {
    let ordinals = held.get(id);
    if (ordinals === undefined) held.set(id, (ordinals = new Set()));
    return ordinals;
  };
  for (const module of modules) {
    const hits = into(entered.hits, module.id);
    const shared = into(entered.shared, module.id);
    const plain = into(entered.plain, module.id);
    const evaluating = new Set(module.shared);
    for (const ordinal of module.hits) {
      hits.add(ordinal);
      if (!evaluating.has(ordinal)) plain.add(ordinal);
    }
    for (const ordinal of module.shared) shared.add(ordinal);
    for (const ordinal of module.again ?? []) plain.add(ordinal);
  }
}

/** What an owner entered as one window's modules, by id and by ordinal. */
export function modulesEntered(entered: EnteredModules): ExecutedModule[] {
  const sorted = (ordinals: Iterable<number>): number[] => [...ordinals].sort((a, b) => a - b);
  return [...entered.hits]
    .map(([id, ordinals]): ExecutedModule => {
      const shared = sorted(entered.shared.get(id) ?? []);
      const plain = entered.plain.get(id);
      const again = shared.filter((ordinal) => plain?.has(ordinal) === true);
      return { id, hits: sorted(ordinals), shared, ...(again.length === 0 ? {} : { again }) };
    })
    .sort((left, right) => codeUnitOrder(left.id, right.id));
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
    readonly modules: EnteredModules;
    readonly preconditions: Map<string, CoveragePrecondition>;
    complete: boolean;
    instrumentation: string;
    duration?: number;
  }
  const byOwner = new Map<string, Held>();

  for (const subjects of sources) {
    for (const subject of subjects) {
      const held = byOwner.get(subject.owner) ?? {
        modules: enteredModules(),
        preconditions: new Map<string, CoveragePrecondition>(),
        complete: true,
        instrumentation: INSTRUMENTATION_ID,
      };
      enterModules(held.modules, subject.journal.modules);
      for (const precondition of subject.preconditions ?? []) {
        held.preconditions.set(precondition.name, precondition);
      }
      if (subject.complete === false) held.complete = false;
      if (subject.duration !== undefined) held.duration = (held.duration ?? 0) + subject.duration;
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
      ...(held.duration === undefined ? {} : { duration: held.duration }),
      journal: {
        instrumentation: held.instrumentation,
        modules: modulesEntered(held.modules),
      },
      ...(held.preconditions.size === 0
        ? {}
        : { preconditions: [...held.preconditions.values()] }),
    }));
}


/**
 * Cases as the index reads them, with module evaluation put back.
 *
 * One difference between the two folds has to be closed here or the index
 * under-credits, which is the one direction selection may not go.
 * {@link recordExecution} gives every region a module entered *while
 * evaluating* to every subject of the run, because a module evaluates once per
 * realm and whichever subject was first did not earn it.
 * {@link executionIndexFrom} does no such spreading — it reads `shared` only to
 * mark a crossing as loaded rather than entered — so handing it the raw
 * per-case journals would credit each module's root to the one case that
 * happened to need it first and to none of the rest.
 *
 * The bucket that belongs to no case is exactly what the ambient journal is
 * for, and the index folds a file's ambient bucket into every case of that
 * file. So the run's evaluation goes into one ambient journal per file, and
 * each case is credited with it.
 */
export function caseJournals(cases: readonly ObservedCase[]): readonly CaseJournal[] {
  const evaluated = new Map<ModuleId, Set<number>>();
  for (const observed of cases) {
    for (const module of observed.journal.modules) {
      const evaluating = new Set(module.shared);
      const held = evaluated.get(module.id) ?? new Set<number>();
      for (const ordinal of module.hits) if (evaluating.has(ordinal)) held.add(ordinal);
      evaluated.set(module.id, held);
    }
  }
  const shared = [...evaluated]
    .filter(([, ordinals]) => ordinals.size > 0)
    .map(([id, ordinals]) => ({ id, hits: [...ordinals], shared: [...ordinals] }));

  // A case with no name is the ambient bucket as far as the index is concerned,
  // so a driver that could not name one is dropped rather than folded into a
  // bucket that would then be given to every case of its file.
  const named = cases.filter((observed) => observed.name !== AMBIENT && observed.id !== AMBIENT);
  const files = [...new Set(named.map((observed) => observed.file))];
  return [
    ...named.map((observed) => ({
      file: observed.file,
      name: observed.name,
      id: observed.id,
      ...(observed.project === undefined ? {} : { project: observed.project }),
      ...(observed.stopped === undefined ? {} : { stopped: observed.stopped }),
      ...(observed.duration === undefined ? {} : { duration: observed.duration }),
      ...(observed.said === undefined ? {} : { said: observed.said }),
      modules: [
        ...observed.journal.modules,
        // Entered both ways: once as the module evaluated, which the ambient
        // journal gives the file, and once as the case's own, written as a
        // second row with nothing shared, as a case frame writes it.
        ...observed.journal.modules
          .filter((module) => (module.again?.length ?? 0) > 0)
          .map((module) => ({ id: module.id, hits: module.again!, shared: [] })),
      ],
    })),
    ...files.map((file) => ({ file, name: AMBIENT, id: AMBIENT, modules: shared })),
  ];
}

