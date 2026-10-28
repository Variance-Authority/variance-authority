// compass: variance-authority.acquisition.collector-contract
import { componentInstances, type SourceIndex, type SourceRef, type SubjectComposition } from '@variance-authority/core/attribute';
import { canonicalize, stepClock, timeOn, type CanonicalValue, type StepClock } from '@variance-authority/core/format';
import { codeUnitOrder } from '@variance-authority/core/segment';
import type { Config } from '../config.js';
import { matchesGlob, visited, type Collected, type Collector, type Plan, type PlannedSubject } from './collector.js';
import { closeLanes, openLanes, steal, type Lane } from './lanes.js';
import { shardFilterBecause, type NotObserved } from './run-report.js';
import { declinedBy } from './shard.js';

/**
 * The half of a run that is not a comparison: every subject a shard owns,
 * collected once, in its lane, and reduced to its composition.
 *
 * `variance run` hands each collected subject on to be observed and compared;
 * `variance collect` is this and nothing after it. Both read the same subjects
 * the same way, so the suite index either writes is counted from one reading.
 */

export type Read = Extract<Collected, { ok: true }>;

export interface AcquireInput {
  readonly plan: Plan;
  /** This shard's plan indices, grouped, from `assign`. */
  readonly queue: readonly (readonly number[])[];
  readonly collector: Collector;
  readonly config: Config;
  /** Subjects a selection ruled out, with why. */
  readonly skipped?: ReadonlyMap<string, string>;
  /** `--subjects`: what it leaves out is excluded, by name. */
  readonly scope?: string;
  readonly elapsed?: () => number;
  /**
   * A subject this shard owns and did not read: declined before the collector,
   * or failed or excluded in it. Called once per subject the visit to `index`
   * realized, so more than once for a story read at several widths.
   */
  readonly passed: (index: number, entry: NotObserved) => void;
  /** Whether to stop taking subjects; `run` stops once its store has failed. */
  readonly stopped?: () => boolean;
  /**
   * The subjects the visit to `index` realized, read or not, once it returns
   * having read at least one and knowing them all: a visit that read none, or
   * that says it is `incomplete`, learned nothing certain of what
   * the subject realizes, and is reported as no visit. A subject that excluded
   * itself at its visit realized none, and is reported with an empty list.
   */
  readonly realized?: (index: number, subjects: readonly PlannedSubject[]) => void;
  /** Every index the queue holds, once it is done with, however it ended. */
  readonly settled?: (index: number) => void;
  /**
   * What the caller does with a subject that was read, in the lane that read it.
   * `planned` is the subject as the visit realized it; `index` is the plan's,
   * shared by every subject one visit realized.
   */
  readonly read?: (
    index: number,
    planned: PlannedSubject,
    collected: Read,
    lane: Lane,
    started: number | undefined,
    /** This subject's steps so far, on `elapsed`; absent without it. */
    steps: StepClock | undefined,
  ) => Promise<void>;
}

export interface Acquisition {
  /**
   * One list per planned subject, in plan order: a composition for each subject
   * its visit read with a snapshot, in the order the visit realized them.
   */
  readonly compositions: readonly (readonly SubjectComposition[])[];
  /** Where the engines located the components they rendered, over every lane. */
  readonly declared?: SourceIndex;
  readonly warnings: readonly string[];
  /** The worlds it collected in; absent when it owned nothing and opened none. */
  readonly workers?: number;
}

export async function acquire(input: AcquireInput): Promise<Acquisition> {
  const { plan, elapsed } = input;
  const compositions: SubjectComposition[][] = plan.subjects.map(() => []);
  const declared = new Map<string, readonly SourceRef[]>();
  // A shard that owns nothing opens nothing.
  if (input.queue.length === 0) return { compositions, warnings: [] };

  const { lanes, warnings } = await openLanes(input.collector, input.config, input.queue.length);
  // Said once however many visits said it, in the order they were first said.
  const said = new Set<string>();

  const readRealized = async (
    index: number,
    planned: PlannedSubject,
    collected: Read,
    lane: Lane,
    started: number | undefined,
  ): Promise<void> => {
    // On the clock `started` was read from. The collector's steps first, under
    // its own name: it timed them on its own clock, and only their durations
    // cross over, so nothing here times them again.
    const steps = elapsed === undefined ? undefined : stepClock(elapsed);
    steps?.add(collected.steps, 'collect.');

    for (const [component, refs] of Object.entries(collected.source ?? {})) locate(declared, component, refs);
    // Per boundary rather than per component name, which is what makes it
    // comparable to another subject's: the instance list is the unit the suite's
    // own graph is folded from. Taken here, in the worker, because the snapshot
    // is not retained past this scope on the path that keeps no history.
    const snapshot = collected.snapshot;
    if (snapshot !== undefined) {
      compositions[index]!.push({
        subject: planned.subject.id,
        instances: await timeOn(steps, 'compose', () => componentInstances(snapshot)),
        // Carried so a divergence can name the input that moved. FIXME: it and
        // `readings` hold every tree to the end — 28.8 GB at 502 (spec 0052).
        snapshot,
      });
    }
    await input.read?.(index, planned, collected, lane, started, steps);
  };

  const readOne = async (index: number, lane: Lane): Promise<void> => {
    const planned = plan.subjects[index]!;
    const declined = declinedBy(planned.subject.id, input.skipped, input.scope);
    if (declined !== undefined) return input.passed(index, declined);
    if (input.stopped?.() === true) return;

    let started: number | undefined;
    const result = await lane.collecting(async () => {
      started = elapsed?.();
      return lane.collector.collect(planned);
    });
    if ('subjects' in result) for (const warning of result.warnings ?? []) said.add(warning);
    const subjects = visited(planned, result);
    const learned = !('subjects' in result && result.incomplete === true) && subjects.some((entry) => entry.collected.ok);
    if (learned) input.realized?.(index, subjects.map((entry) => entry.planned));
    // Excluded at its visit, the subject said it is none of this run's: it
    // realizes nothing, and what the store holds of it is left behind.
    else if (!('subjects' in result) && !result.ok && result.excluded === true) input.realized?.(index, []);

    for (const { planned: realized, collected } of subjects) {
      const id = realized.subject.id;
      // The glob decides on what the visit realized: the plan named the story,
      // and `--subjects` may name one of its widths.
      if (input.scope !== undefined && !matchesGlob(input.scope, id)) {
        input.passed(index, { subject: id, kind: 'excluded', because: shardFilterBecause(input.scope) });
        continue;
      }
      if (!collected.ok) {
        input.passed(index, { subject: id, kind: collected.excluded === true ? 'excluded' : 'failed', because: collected.because });
        continue;
      }
      await readRealized(index, realized, collected, lane, started);
      // One visit read every subject it realized, so the first carries the
      // visit and each after it only its own observation: summed over the
      // story, the time is what the story cost.
      started = elapsed?.();
    }
  };
  await steal(lanes, input.queue, input.config, async (index, lane) => {
    try {
      await readOne(index, lane);
    } finally {
      input.settled?.(index);
    }
  }).finally(async () => closeLanes(lanes));

  return {
    compositions,
    ...(declared.size === 0 ? {} : { declared: Object.fromEntries([...declared].sort(([l], [r]) => codeUnitOrder(l, r))) }),
    warnings: [...warnings, ...said],
    workers: lanes.length,
  };
}

/**
 * Keep the answer whose canonical form sorts first. A minimum is the same over
 * any order, so neither the subject that finished first nor the lane it ran in
 * decides which file a component is in.
 */
function locate(into: Map<string, readonly SourceRef[]>, component: string, refs: readonly SourceRef[]): void {
  const held = into.get(component);
  if (held === refs) return;
  if (held === undefined || codeUnitOrder(canonicalize(refs as unknown as CanonicalValue), canonicalize(held as unknown as CanonicalValue)) < 0) {
    into.set(component, refs);
  }
}
