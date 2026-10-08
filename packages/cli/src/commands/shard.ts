import { longestFirst, place } from '@variance-authority/core/shard';
import { matchesGlob, type PlannedSubject } from './collector.js';
import type { Shard } from '../shard-args.js';
import { shardFilterBecause, shardOwnedBecause, type NotObserved } from './run-report.js';

/**
 * Which subjects this shard owns, and in what order its workers take them.
 *
 * Three rules, each answering a way a name-based slice goes wrong:
 *
 * - **The unit is the declaring file, never the subject.** Every story of one
 *   CSF file and every width of one route load the same module graph; split
 *   across machines, each machine pays for it. `declaredIn` is the key, and a
 *   subject with none is its own group.
 * - **Where each group goes is `place` in `@variance-authority/core/shard`**,
 *   the rule a test runner's seam places test files by: the recorded time
 *   when a previous report carries `costMs`, longest first on the
 *   least-loaded shard, and a checksum otherwise. A placement by time is a
 *   function of the *whole* plan, so shards must plan the same suite — when
 *   they do not, `merge` sees the overlap or the gap and refuses, rather than
 *   a subject going unwatched.
 */

/** Subject id to milliseconds, read from a previous report's `costMs`. */
export type Costs = ReadonlyMap<string, number>;

export function groupOf(planned: PlannedSubject): string {
  return planned.declaredIn ?? planned.subject.id;
}

/** Plan indices grouped by declaring file, groups in order of first appearance. */
function groupsOf(subjects: readonly PlannedSubject[]): { readonly key: string; readonly members: number[] }[] {
  const byKey = new Map<string, { key: string; members: number[] }>();
  subjects.forEach((planned, index) => {
    const key = groupOf(planned);
    const group = byKey.get(key) ?? { key, members: [] };
    group.members.push(index);
    byKey.set(key, group);
  });
  return [...byKey.values()];
}

export interface Assignment {
  /** Plan indices this shard observes, grouped, in the order workers should take them. */
  readonly queue: readonly (readonly number[])[];
  /** Plan index to the shard that owns it, for every subject this shard does not. */
  readonly elsewhere: ReadonlyMap<number, number>;
  readonly by: 'checksum' | 'recorded cost';
}

/**
 * Assign groups to shards and order this shard's queue.
 *
 * Without a shard every group is this run's, and the queue is still ordered:
 * longest first when costs are known, so the worker that finishes early steals
 * the short tail rather than the long head; plan order otherwise.
 */
export function assign(
  subjects: readonly PlannedSubject[],
  shard: Shard | undefined,
  costs: Costs | undefined,
): Assignment {
  const groups = groupsOf(subjects);
  const placement = place(
    groups.map(({ key, members }) => ({ key, costs: members.map((index) => costs?.get(subjects[index]?.subject.id ?? '')) })),
    shard?.total ?? 1,
  );
  const here = shard?.index ?? 1;
  const elsewhere = new Map<number, number>();
  groups.forEach((group, at) => {
    const owner = placement.owner[at]!;
    if (owner !== here) for (const index of group.members) elsewhere.set(index, owner);
  });
  const mine = (order: readonly number[]) => order.filter((at) => placement.owner[at] === here).map((at) => groups[at]!.members);
  const inPlan = groups.map((_, at) => at);
  return {
    queue: mine(placement.cost === undefined ? inPlan : longestFirst(groups.map((group) => group.key), placement.cost)),
    elsewhere,
    by: placement.by,
  };
}

/**
 * The exclusion every subject another shard owns is reported under. It names
 * the shard and what placed it there — a checksum, or the costs of one commit —
 * so two shards that placed by different costs are visible in their reports.
 */
export function placedElsewhere(
  subjects: readonly PlannedSubject[],
  assignment: Assignment,
  options: { readonly shard?: Shard; readonly costs?: { readonly commit: string } },
): ReadonlyMap<number, NotObserved> {
  const by =
    assignment.by === 'checksum' || options.costs === undefined
      ? 'checksum'
      : `the costs recorded at ${options.costs.commit.slice(0, 12)}`;
  const entries = new Map<number, NotObserved>();
  for (const [index, owner] of assignment.elsewhere) {
    entries.set(index, {
      subject: subjects[index]?.subject.id ?? '',
      kind: 'excluded',
      because: shardOwnedBecause(owner, options.shard?.total ?? 1, by),
    });
  }
  return entries;
}

/**
 * Why this shard's own subject is not collected, if it is not: `unreached` when
 * the diff was derived not to arrive — nobody configured that — and `excluded`
 * when `--subjects` left it out, which somebody did.
 */
export function declinedBy(
  id: string,
  skipped: ReadonlyMap<string, string> | undefined,
  glob: string | undefined,
): NotObserved | undefined {
  const ruledOut = skipped?.get(id);
  if (ruledOut !== undefined) return { subject: id, kind: 'unreached', because: ruledOut };
  if (glob !== undefined && !matchesGlob(glob, id)) {
    return { subject: id, kind: 'excluded', because: shardFilterBecause(glob) };
  }
  return undefined;
}
