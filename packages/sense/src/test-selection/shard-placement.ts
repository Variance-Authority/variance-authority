/**
 * Which test files one shard of a run takes, when the runner was asked for
 * `--shard k/n`: the files of the whole run, placed by the rule
 * `@variance-authority/core/shard` places every suite by — by the times the
 * record holds, or by checksum when it holds none of them.
 *
 * Every shard computes the placement of every file and keeps its own part, so
 * shards that discovered the same files and read the same record agree with no
 * word between them. The runner's own split never decides: it divides by
 * count, and a runner that splits a file's cases divides the file with them.
 *
 * A file is placed whole. One handed in more than once — once for each project
 * of a run that runs it — is one group, priced at its time once per copy, and
 * every copy goes to the same shard.
 */

// compass: variance-authority.reach

import { durationText, place } from '@variance-authority/core/shard';
import { codeUnitOrder } from './instrumented-modules.js';
import type { SuiteTimes } from './suite-selection.js';

/** `--shard k/n` as the runner parsed it: `index` from 1. */
export interface ShardAsked {
  readonly index: number;
  readonly count: number;
}

/**
 * This shard's files, as positions in the list handed in, and the line that
 * says how they were chosen. Placed by time, the longest come first; placed by
 * checksum, they come in code-unit order of path.
 */
export interface ShardPart {
  readonly take: readonly number[];
  readonly line: string;
}

/** The part of `files` shard `shard.index` of `shard.count` takes, placed by `times`. */
export function shardOf(files: readonly string[], shard: ShardAsked, times: SuiteTimes): ShardPart {
  const head = `variance-authority: shard ${shard.index}/${shard.count}`;
  const copies = new Map<string, number>();
  for (const file of files) copies.set(file, (copies.get(file) ?? 0) + 1);
  const keys = [...copies.keys()];
  const recorded = 'unread' in times ? undefined : times.times;
  const placement = place(
    keys.map((key) => ({ key, costs: Array.from({ length: copies.get(key)! }, () => recorded?.get(key)) })),
    shard.count,
  );
  const mine = keys.filter((_, at) => placement.owner[at] === shard.index);
  const part = `${mine.length} of ${counted(keys.length, 'file')}`;
  if (placement.by === 'checksum' || 'unread' in times) {
    const why = 'unread' in times
      ? `no times at ${times.recording ?? 'the record'}: ${times.unread}`
      : `${times.recording} holds no time for any of them`;
    return { take: positions(files, mine.sort(codeUnitOrder)), line: `${head} by checksum: ${part}; ${why}` };
  }
  const cost = new Map(keys.map((key, at) => [key, placement.cost![at]!]));
  const load = placement.load!;
  const untimed = keys.filter((key) => !times.times.has(key)).length;
  mine.sort((left, right) => cost.get(right)! - cost.get(left)! || codeUnitOrder(left, right));
  const at = times.commit === undefined ? times.recording : times.commit.slice(0, 12);
  const span = `shards ${durationText(Math.min(...load))} to ${durationText(Math.max(...load))}`;
  const priced = untimed === 0 ? '' : `; ${untimed} untimed, priced at the median`;
  return {
    take: positions(files, mine),
    line: `${head} by the times recorded at ${at}: ${part}, ${durationText(load[shard.index - 1] ?? 0)} (${span})${priced}`,
  };
}

/** Every position in `files` of each of `keys`, in the order of `keys`. */
function positions(files: readonly string[], keys: readonly string[]): number[] {
  const at = new Map<string, number[]>();
  files.forEach((file, position) => at.set(file, [...(at.get(file) ?? []), position]));
  return keys.flatMap((key) => at.get(key) ?? []);
}

function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
