import { createHash } from 'node:crypto';
import { matchesGlob, type PlannedSubject } from './collector.js';
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
 * - **Without costs, a checksum decides.** Rendezvous hashing — each group goes
 *   to the shard whose `sha256(group, shard)` is highest — depends on the group
 *   and the shard count and on nothing else, so adding a story moves no other
 *   file and two machines that discovered different plans still agree on every
 *   group they share.
 * - **With costs, the recorded time decides.** A previous report carries
 *   `costMs` per subject; groups are placed longest first on the least-loaded
 *   shard (LPT). That placement is a function of the *whole* plan, so shards
 *   must plan the same suite — when they do not, `merge` sees the overlap or
 *   the gap and refuses, rather than a subject going unwatched.
 */

export interface Shard {
  /** 1-based, as `--shard 2/4` spells it. */
  readonly index: number;
  readonly total: number;
}

/** Subject id to milliseconds, read from a previous report's `costMs`. */
export type Costs = ReadonlyMap<string, number>;

/** `k/n`, or the sentence saying why not. */
export function parseShard(text: string): Shard | string {
  const match = /^(\d+)\/(\d+)$/.exec(text);
  if (match === null) return `\`--shard\` takes \`k/n\`, such as \`2/4\`; got \`${text}\``;
  const index = Number(match[1]);
  const total = Number(match[2]);
  if (total < 1 || index < 1 || index > total) {
    return `\`--shard ${text}\` names no shard: k must be between 1 and n`;
  }
  return { index, total };
}

export function groupOf(planned: PlannedSubject): string {
  return planned.declaredIn ?? planned.subject.id;
}

interface Group {
  readonly key: string;
  /** Plan indices, in plan order. */
  readonly members: number[];
  /** Estimated milliseconds; `undefined` when no subject in the run has a cost. */
  cost?: number;
}

/** Plan indices grouped by declaring file, groups in order of first appearance. */
function groupsOf(subjects: readonly PlannedSubject[], costs: Costs | undefined): Group[] {
  const byKey = new Map<string, Group>();
  subjects.forEach((planned, index) => {
    const key = groupOf(planned);
    const group = byKey.get(key) ?? { key, members: [] };
    group.members.push(index);
    byKey.set(key, group);
  });
  const groups = [...byKey.values()];

  // An unrecorded subject is estimated at the median of the recorded ones: a new
  // story is a story, and pricing it at zero would stack every new file on one
  // shard. No recorded subject at all is no estimate, and the checksum decides.
  const known = subjects.flatMap((planned) => {
    const cost = costs?.get(planned.subject.id);
    return cost === undefined ? [] : [cost];
  });
  if (known.length === 0) return groups;
  const median = [...known].sort((a, b) => a - b)[Math.floor(known.length / 2)] ?? 0;
  for (const group of groups) {
    group.cost = group.members.reduce(
      (sum, index) => sum + (costs?.get(subjects[index]?.subject.id ?? '') ?? median),
      0,
    );
  }
  return groups;
}

/** Longest first; ties by key in code-unit order, so the order is a function of the plan. */
function byCostDescending(a: Group, b: Group): number {
  const difference = (b.cost ?? 0) - (a.cost ?? 0);
  if (difference !== 0) return difference;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

function rendezvous(key: string, total: number): number {
  let best = 1;
  let bestScore = '';
  for (let shard = 1; shard <= total; shard++) {
    const score = createHash('sha256').update(`${key}\0${shard}`).digest('hex');
    if (score > bestScore) {
      best = shard;
      bestScore = score;
    }
  }
  return best;
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
  const groups = groupsOf(subjects, costs);
  const costed = groups.some((group) => group.cost !== undefined);
  const total = shard?.total ?? 1;
  const owner = new Map<Group, number>();

  if (costed) {
    const load = Array.from({ length: total }, () => 0);
    for (const group of [...groups].sort(byCostDescending)) {
      let least = 0;
      for (let k = 1; k < total; k++) if ((load[k] ?? 0) < (load[least] ?? 0)) least = k;
      load[least] = (load[least] ?? 0) + (group.cost ?? 0);
      owner.set(group, least + 1);
    }
  } else {
    for (const group of groups) owner.set(group, total === 1 ? 1 : rendezvous(group.key, total));
  }

  const mine = groups.filter((group) => owner.get(group) === (shard?.index ?? 1));
  const elsewhere = new Map<number, number>();
  for (const group of groups) {
    const k = owner.get(group) ?? 1;
    if (k !== (shard?.index ?? 1)) for (const index of group.members) elsewhere.set(index, k);
  }

  return {
    queue: (costed ? [...mine].sort(byCostDescending) : mine).map((group) => group.members),
    elsewhere,
    by: costed ? 'recorded cost' : 'checksum',
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
