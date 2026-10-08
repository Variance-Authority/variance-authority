/**
 * Which test files one shard of a run takes, when the runner was asked for
 * `--shard k/n`: the files of the whole run, placed by the times its record
 * holds, by the rule `@variance-authority/core/shard` places every suite by.
 *
 * Every shard computes the placement of every file and keeps its own part, so
 * shards that discovered the same files and read the same record agree with no
 * word between them. A record that times none of them places nothing, and the
 * runner's own split, which divides by count, decides instead.
 */

// compass: variance-authority.reach

import { durationText, place } from '@variance-authority/core/shard';
import type { SuiteTimes } from './suite-selection.js';

/** `--shard k/n` as the runner parsed it: `index` from 1. */
export interface ShardAsked {
  readonly index: number;
  readonly count: number;
}

/**
 * This shard's files, as positions in the list handed in, longest first, and
 * the line that says how they were chosen. No positions means the runner splits.
 */
export interface ShardPart {
  readonly take?: readonly number[];
  readonly line: string;
}

/** The part of `files` shard `shard.index` of `shard.count` takes, placed by `times`. */
export function shardOf(files: readonly string[], shard: ShardAsked, times: SuiteTimes): ShardPart {
  const head = `variance-authority: shard ${shard.index}/${shard.count}`;
  const byRunner = `${head} split by the runner, by count`;
  if ('unread' in times) return { line: `${byRunner}: no times at ${times.recording ?? 'the record'}: ${times.unread}` };
  const untimed = files.filter((file) => !times.times.has(file)).length;
  if (untimed === files.length) {
    return { line: `${byRunner}: ${times.recording} holds no time for any of its ${counted(files.length, 'file')}` };
  }
  const placement = place(files.map((file) => ({ key: file, costs: [times.times.get(file)] })), shard.count);
  const cost = placement.cost!;
  const load = placement.load!;
  const mine = files
    .map((_, at) => at)
    .filter((at) => placement.owner[at] === shard.index)
    .sort((left, right) => cost[right]! - cost[left]!);
  const at = times.commit === undefined ? times.recording : times.commit.slice(0, 12);
  const span = `shards ${durationText(Math.min(...load))} to ${durationText(Math.max(...load))}`;
  const priced = untimed === 0 ? '' : `; ${untimed} untimed, priced at the median`;
  return {
    take: mine,
    line: `${head} by the times recorded at ${at}: ${mine.length} of ${counted(files.length, 'file')}, ` +
      `${durationText(load[shard.index - 1] ?? 0)} (${span})${priced}`,
  };
}

function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
