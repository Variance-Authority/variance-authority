// compass: variance-authority.acquisition.suite-observation
import { componentInstances, type SourceIndex, type SourceRef, type SubjectComposition } from '@variance-authority/core/attribute';
import { canonicalize, type CanonicalValue } from '@variance-authority/core/format';
import { codeUnitOrder } from '@variance-authority/core/segment';
import type { Config } from '../config.js';
import type { Collected, Collector, Plan, PlannedSubject } from './collector.js';
import { closeLanes, openLanes, steal, workersOf, type Lane } from './lanes.js';
import type { NotObserved } from './run-report.js';
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
  /** A subject this shard owns and did not read: declined before the collector, or failed in it. */
  readonly passed: (index: number, entry: NotObserved) => void;
  /** Whether to stop taking subjects; `run` stops once its store has failed. */
  readonly stopped?: () => boolean;
  /** What the caller does with a subject that was read, in the lane that read it. */
  readonly read?: (index: number, planned: PlannedSubject, collected: Read, lane: Lane, started: number | undefined) => Promise<void>;
}

export interface Acquisition {
  /** One slot per planned subject, in plan order; `null` where nothing was read. */
  readonly compositions: readonly (SubjectComposition | null)[];
  /** Where the engines located the components they rendered, over every lane. */
  readonly declared?: SourceIndex;
  readonly warnings: readonly string[];
}

export async function acquire(input: AcquireInput): Promise<Acquisition> {
  const { plan, elapsed } = input;
  const compositions: (SubjectComposition | null)[] = plan.subjects.map(() => null);
  const declared = new Map<string, readonly SourceRef[]>();
  // A shard that owns nothing opens nothing.
  if (input.queue.length === 0) return { compositions, warnings: [] };

  const { lanes, warnings } = await openLanes(input.collector, workersOf(input.config));
  await steal(lanes, input.queue, input.config, async (index, lane) => {
    const planned = plan.subjects[index]!;
    const id = planned.subject.id;
    const declined = declinedBy(id, input.skipped, input.scope);
    if (declined !== undefined) return input.passed(index, declined);
    if (input.stopped?.() === true) return;

    let started: number | undefined;
    const collected = await lane.collecting(async () => {
      started = elapsed?.();
      return lane.collector.collect(planned);
    });
    if (!collected.ok) return input.passed(index, { subject: id, kind: 'failed', because: collected.because });

    for (const [component, refs] of Object.entries(collected.source ?? {})) locate(declared, component, refs);
    // Per boundary rather than per component name, which is what makes it
    // comparable to another subject's: the instance list is the unit the suite's
    // own graph is folded from. Taken here, in the worker, because the snapshot
    // is not retained past this scope on the path that keeps no history.
    if (collected.snapshot !== undefined) {
      compositions[index] = {
        subject: id,
        instances: componentInstances(collected.snapshot),
        // Carried so a divergence can name the input that moved. FIXME: it and
        // `readings` hold every tree to the end — 28.8 GB at 502 (spec 0052).
        snapshot: collected.snapshot,
      };
    }
    await input.read?.(index, planned, collected, lane, started);
  }).finally(async () => closeLanes(lanes));

  return {
    compositions,
    ...(declared.size === 0 ? {} : { declared: Object.fromEntries([...declared].sort(([l], [r]) => codeUnitOrder(l, r))) }),
    warnings,
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
