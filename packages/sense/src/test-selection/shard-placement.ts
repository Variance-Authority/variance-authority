/**
 * Which test files one shard of a run takes, when the runner was asked for
 * `--shard k/n`: the files of the whole run, placed by the rule
 * `@variance-authority/core/shard` places every suite by: longest first, each
 * file priced at the time the record holds for it. A file it holds no time for
 * is priced at the median of those it does, and when it holds none, every file
 * weighs the same under the same rule, so the shards are balanced by count and
 * none is left without a file while there are as many files as shards.
 *
 * Every shard computes the placement of every file and keeps its own part, so
 * shards that discovered the same files and read the same record agree with no
 * word between them. The runner's own split never decides: it divides by
 * count, and a runner that splits a file's cases divides the file with them.
 *
 * A file is placed whole. One handed in more than once — once for each project
 * of a run that runs it — is one group, priced at its recorded time once,
 * because that time already sums every project that ran it, and every copy goes
 * to the same shard.
 */

// compass: variance-authority.reach

import { codeUnitOrder } from '@variance-authority/core/segment';
import { durationText, place } from '@variance-authority/core/shard';
import type { SuiteTimes } from './suite-selection.js';

/** `--shard k/n` as the runner parsed it: `index` from 1. */
export interface ShardAsked {
  readonly index: number;
  readonly count: number;
}

/**
 * This shard's files, as positions in the list handed in, and the line that
 * says how they were chosen. The longest come first, and files priced the same
 * come in code-unit order of path.
 */
export interface ShardPart {
  readonly take: readonly number[];
  readonly line: string;
}

/** The part of `files` shard `shard.index` of `shard.count` takes, placed by `times`. */
export function shardOf(files: readonly string[], shard: ShardAsked, times: SuiteTimes): ShardPart {
  const head = `variance-authority: shard ${shard.index}/${shard.count}`;
  const keys = [...new Set(files)];
  const recorded = 'unread' in times ? undefined : times.times;
  const placement = place(keys.map((key) => ({ key, costs: [recorded?.get(key)] })), shard.count);
  const mine = keys.filter((_, at) => placement.owner[at] === shard.index);
  const cost = new Map(keys.map((key, at) => [key, placement.cost[at]!]));
  mine.sort((left, right) => cost.get(right)! - cost.get(left)! || codeUnitOrder(left, right));
  const part = `${mine.length} of ${counted(keys.length, 'file')}`;
  if (placement.by === 'count' || 'unread' in times) {
    const why = 'unread' in times
      ? `no times at ${times.recording ?? 'the record'}: ${times.unread}`
      : `${times.recording} holds no time for any of them`;
    return { take: positions(files, mine), line: `${head} by file count: ${part}; ${why}` };
  }
  const load = placement.load;
  const untimed = keys.filter((key) => !times.times.has(key)).length;
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

/**
 * The `--shard k/n` a command line asks for, in either spelling, `--shard k/n`
 * or `--shard=k/n`; `undefined` when it asks for none. Every runner's seam reads
 * the command line through this one, to settle what has to be settled before
 * the runner places anything.
 */
export function shardArgument(argv: readonly string[]): ShardAsked | undefined {
  for (const [at, argument] of argv.entries()) {
    const value = argument === '--shard' ? argv[at + 1] : argument.startsWith('--shard=') ? argument.slice('--shard='.length) : undefined;
    const parsed = value === undefined ? null : /^(\d+)\/(\d+)$/u.exec(value);
    if (parsed !== null) return { index: Number(parsed[1]), count: Number(parsed[2]) };
  }
  return undefined;
}
