/**
 * Which shard runs which group, and how many shards a suite is worth.
 *
 * A group is placed whole: every story of one file, every width of one route,
 * every case of one test file loads the same modules, and split across
 * machines each machine pays for them. Three rules decide where it goes:
 *
 * - **With recorded times, the time decides.** Groups go longest first to the
 *   shard with the least time so far (LPT, within 4/3 of the best split). Ties
 *   are broken by key in code-unit order, so the placement is a function of
 *   the groups and their times and never of the order they were found in.
 * - **A member nothing recorded is priced at the median of the recorded ones.**
 *   A new file is a file, and pricing it at zero would stack every new one on
 *   one shard.
 * - **With nothing recorded, a checksum decides.** Each group goes to the shard
 *   whose `sha256(key, shard)` is highest, which depends on the key and the
 *   shard count alone, so adding a group moves no other.
 *
 * Every shard computes the whole placement and keeps its own part. Nothing is
 * exchanged between shards, so two shards agree exactly when they were handed
 * the same groups and the same times.
 */

import { sha256Hex } from '../format/sha256.js';
import { codeUnitOrder } from '../segment/index.js';

/** One group placed whole, and the milliseconds recorded for each of its members. */
export interface Placeable {
  readonly key: string;
  /** `undefined` for a member nothing recorded a time for. */
  readonly costs: readonly (number | undefined)[];
}

export interface Placement {
  /** The shard, from 1, of each group in the order they were handed in. */
  readonly owner: readonly number[];
  readonly by: 'checksum' | 'recorded cost';
  /** Milliseconds each group is priced at; absent when placed by checksum. */
  readonly cost?: readonly number[];
  /** Milliseconds each shard was given, shard 1 first; absent when placed by checksum. */
  readonly load?: readonly number[];
}

/**
 * Each group's price: its members' recorded milliseconds, with the median of
 * every recorded member standing in for one nothing recorded. Absent when no
 * member of any group is recorded, because then there is no price to give.
 */
export function priced(groups: readonly Placeable[]): number[] | undefined {
  const known = groups.flatMap((group) => group.costs.filter((cost): cost is number => cost !== undefined));
  if (known.length === 0) return undefined;
  const median = known.sort((a, b) => a - b)[Math.floor(known.length / 2)]!;
  return groups.map((group) => group.costs.reduce<number>((sum, cost) => sum + (cost ?? median), 0));
}

/** Place every group on one of `total` shards. */
export function place(groups: readonly Placeable[], total: number): Placement {
  const cost = priced(groups);
  if (cost === undefined) {
    return { owner: groups.map((group) => (total === 1 ? 1 : rendezvous(group.key, total))), by: 'checksum' };
  }
  const order = longestFirst(groups.map((group) => group.key), cost);
  const { owner, load } = packed(order.map((index) => cost[index]!), total);
  const byGroup: number[] = new Array<number>(groups.length);
  order.forEach((index, at) => (byGroup[index] = owner[at]!));
  return { owner: byGroup, by: 'recorded cost', cost, load };
}

/**
 * Group indices, longest first, ties by key in code-unit order: the order a
 * shard's workers take its groups in, so one that finishes early takes the
 * short ones at the end.
 */
export function longestFirst(keys: readonly string[], cost: readonly number[]): number[] {
  return keys.map((_, index) => index).sort((a, b) => cost[b]! - cost[a]! || codeUnitOrder(keys[a]!, keys[b]!));
}

/** Why a shard count is the one {@link shardCount} chose. */
export type ShardCountReason =
  /** No group to run, so no shard to start. */
  | 'nothing to run'
  /** The fewest shards whose setup and slowest share fit the budget. */
  | 'within budget'
  /** One more shard would save less waiting than the setup it spends. */
  | 'setup'
  /** The slowest group is the longest share already, and no shard finishes before it. */
  | 'slowest group'
  /** The most shards allowed. */
  | 'max';

export interface ShardCountOptions {
  /** Milliseconds a shard spends before its first test: start, checkout, install, build. */
  readonly setup: number;
  /** Milliseconds one shard may take, setup included. */
  readonly budget?: number;
  /** The most shards to start. */
  readonly max?: number;
}

export interface ShardCount {
  readonly shards: number;
  /** Milliseconds of groups each shard runs, shard 1 first, as {@link place} would place them. */
  readonly load: readonly number[];
  /** Milliseconds until the last shard finishes: the setup and the longest share. */
  readonly wall: number;
  readonly why: ShardCountReason;
  /** What one more shard would finish in, when the setup it spends is why it was not added. */
  readonly next?: { readonly wall: number };
}

/**
 * GitHub Actions starts at most 256 jobs from one matrix, the largest limit
 * any CI this tool is run on documents, so a count past it could not be used.
 */
export const MATRIX_LIMIT = 256;

/**
 * How many shards to split groups priced at `costs` milliseconds across.
 *
 * Every shard pays `setup` before it runs a group, so the wait is the setup
 * plus the longest share, and each shard added spends one more setup to
 * shorten that share. With a budget, the count is the fewest shards whose wait
 * fits it. Without one, a shard is added while it saves more waiting than the
 * setup it spends. Either way the count stops where the longest share is the
 * slowest group, because past that no shard finishes sooner.
 */
export function shardCount(costs: readonly number[], options: ShardCountOptions): ShardCount {
  if (costs.length === 0) return { shards: 0, load: [], wall: 0, why: 'nothing to run' };
  const sorted = [...costs].sort((a, b) => b - a);
  const slowest = sorted[0]!;
  const limit = Math.max(1, Math.min(options.max ?? MATRIX_LIMIT, sorted.length));
  const at = (shards: number) => {
    const { load } = packed(sorted, shards);
    return { shards, load, wall: options.setup + Math.max(...load) };
  };
  const counted = (shards: ReturnType<typeof at>, why: ShardCountReason, next?: ReturnType<typeof at>): ShardCount =>
    ({ ...shards, why, ...(next === undefined ? {} : { next: { wall: next.wall } }) });

  let here = at(1);
  for (;;) {
    if (options.budget !== undefined && here.wall <= options.budget) return counted(here, 'within budget');
    if (here.wall - options.setup <= slowest) return counted(here, 'slowest group');
    if (here.shards === limit) return counted(here, 'max');
    const next = at(here.shards + 1);
    if (options.budget === undefined && here.wall - next.wall < options.setup) return counted(here, 'setup', next);
    here = next;
  }
}

/** Milliseconds as a person reads them in a shard's line: `340 ms`, `9.0 s`. */
export function durationText(milliseconds: number): string {
  return milliseconds < 1000 ? `${Math.round(milliseconds)} ms` : `${(milliseconds / 1000).toFixed(1)} s`;
}

/**
 * LPT over costs already sorted longest first: each to the shard with the
 * least so far, the lowest-numbered of equals.
 */
function packed(sorted: readonly number[], total: number): { owner: number[]; load: number[] } {
  const load = new Array<number>(total).fill(0);
  // A binary heap of shard indices by (load, index), so a suite of tens of
  // thousands of files is placed in n log k rather than n·k.
  const heap = Array.from({ length: total }, (_, index) => index);
  const before = (a: number, b: number) => load[a]! < load[b]! || (load[a] === load[b] && a < b);
  const owner = sorted.map((cost) => {
    const least = heap[0]!;
    load[least] = load[least]! + cost;
    for (let at = 0; ; ) {
      const left = 2 * at + 1;
      const right = left + 1;
      let next = at;
      if (left < total && before(heap[left]!, heap[next]!)) next = left;
      if (right < total && before(heap[right]!, heap[next]!)) next = right;
      if (next === at) break;
      [heap[at], heap[next]] = [heap[next]!, heap[at]!];
      at = next;
    }
    return least + 1;
  });
  return { owner, load };
}

function rendezvous(key: string, total: number): number {
  let best = 1;
  let bestScore = '';
  for (let shard = 1; shard <= total; shard++) {
    const score = sha256Hex(`${key}\0${shard}`);
    if (score > bestScore) {
      best = shard;
      bestScore = score;
    }
  }
  return best;
}
