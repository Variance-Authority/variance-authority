/**
 * How many shards a suite is worth: the answer `variance shards` prints.
 *
 * Pure, over the times a record holds and what the change skips, so every rule
 * is assertable with no record and no repository. The count is
 * `shardCount`'s, from `@variance-authority/core/shard`, the same placement
 * every shard of the run computes for itself, so the count predicted here is
 * the count those shards split by.
 *
 * Nothing recorded is not a count of one. A suite with no times has no answer
 * to give, so the command refuses unless `--unrecorded <n>` names the count the
 * operator chose for that case, and the answer says that is where it came from.
 */

import { MATRIX_LIMIT, durationText, shardCount, type ShardCountReason } from '@variance-authority/core/shard';
import type { SuiteTimes } from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';
import { many } from './prose-counts.js';

export type ShardsFormat = 'text' | 'json';

export interface ShardsInput {
  readonly times: SuiteTimes;
  /** Milliseconds each shard spends before its first test. */
  readonly setup: number;
  /** Milliseconds one shard may take, setup included. */
  readonly budget?: number;
  readonly max?: number;
  /** How many test files one shard's runner runs at once. */
  readonly workers?: number;
  /** The count to answer when nothing is recorded; absent, that refuses. */
  readonly unrecorded?: number;
  /** The recorded files the change since `since` lets the run skip. */
  readonly skipped?: { readonly since: string; readonly files: ReadonlySet<string> };
  /** The slowest recorded cases of the slowest file, slowest first, when a run kept cases. */
  readonly cases?: readonly { readonly name: string; readonly duration: number }[];
}

export type ShardsAnswer =
  | {
      readonly shards: number;
      /** `k/n` for each shard, what a CI matrix and `--shard` take. */
      readonly matrix: readonly string[];
      readonly by: 'recorded';
      readonly recording: string;
      readonly commit?: string;
      /** The recorded files that would run. */
      readonly files: number;
      /** The recorded files the change skips; absent when no change was asked about. */
      readonly skipped?: number;
      readonly since?: string;
      readonly setup: number;
      readonly budget?: number;
      readonly max?: number;
      readonly workers?: number;
      /** Milliseconds of tests each shard runs, shard 1 first. */
      readonly load: readonly number[];
      /** Milliseconds until the last shard finishes, setup included. */
      readonly wall: number;
      readonly why: ShardCountReason;
      readonly next?: { readonly wall: number };
      readonly slowest?: {
        readonly file: string;
        readonly duration: number;
        readonly cases?: readonly { readonly name: string; readonly duration: number }[];
      };
    }
  | {
      readonly shards: number;
      readonly matrix: readonly string[];
      readonly by: 'unrecorded';
      readonly recording?: string;
      readonly unread: string;
    };

export function shardsAnswer(input: ShardsInput): ShardsAnswer {
  const { times } = input;
  const unread = 'unread' in times
    ? times.unread
    : times.times.size === 0
      ? 'the record holds no time for any test file'
      : undefined;
  if ('unread' in times || unread !== undefined) {
    const where = times.recording === undefined ? '' : `${times.recording}: `;
    if (input.unrecorded === undefined) {
      throw new OperatorError(
        `${where}${unread}, so there are no times to count shards by. Pass \`--unrecorded <n>\` for the ` +
          'count to answer until the suite is recorded, or record it first.',
      );
    }
    return {
      shards: input.unrecorded,
      matrix: matrixOf(input.unrecorded),
      by: 'unrecorded',
      ...(times.recording === undefined ? {} : { recording: times.recording }),
      unread: unread!,
    };
  }

  const running = [...times.times].filter(([file]) => !(input.skipped?.files.has(file) ?? false));
  const count = shardCount(running.map(([, duration]) => duration), {
    setup: input.setup,
    ...(input.budget === undefined ? {} : { budget: input.budget }),
    ...(input.max === undefined ? {} : { max: input.max }),
    ...(input.workers === undefined ? {} : { workers: input.workers }),
  });
  const slowest = running.reduce<(typeof running)[number] | undefined>(
    (best, entry) => (best === undefined || entry[1] > best[1] || (entry[1] === best[1] && entry[0] < best[0]) ? entry : best),
    undefined,
  );
  return {
    shards: count.shards,
    matrix: matrixOf(count.shards),
    by: 'recorded',
    recording: times.recording,
    ...(times.commit === undefined ? {} : { commit: times.commit }),
    files: running.length,
    ...(input.skipped === undefined ? {} : { skipped: times.times.size - running.length, since: input.skipped.since }),
    setup: input.setup,
    ...(input.budget === undefined ? {} : { budget: input.budget }),
    ...(input.max === undefined ? {} : { max: input.max }),
    ...(input.workers === undefined ? {} : { workers: input.workers }),
    load: count.load,
    wall: count.wall,
    why: count.why,
    ...(count.next === undefined ? {} : { next: count.next }),
    ...(count.why !== 'slowest group' || slowest === undefined
      ? {}
      : {
          slowest: {
            file: slowest[0],
            duration: slowest[1],
            ...(input.cases === undefined || input.cases.length === 0 ? {} : { cases: input.cases }),
          },
        }),
  };
}

export function formatShards(answer: ShardsAnswer, format: ShardsFormat): string {
  if (format === 'json') return `${JSON.stringify(answer, null, 2)}\n`;
  if (answer.by === 'unrecorded') {
    const where = answer.recording === undefined ? '' : ` (${answer.recording})`;
    return `${many(answer.shards, 'shard')}, as --unrecorded says: ${answer.unread}${where}.\n`;
  }
  if (answer.why === 'nothing to run') {
    const all = answer.files + (answer.skipped ?? 0);
    return answer.since === undefined
      ? '0 shards: the record holds no test file to run.\n'
      : `0 shards: the change since ${answer.since} skips every recorded test file, ${all} in all.\n`;
  }
  const longest = Math.max(...answer.load);
  const total = answer.load.reduce((sum, load) => sum + load, 0);
  const at = answer.commit === undefined ? answer.recording : answer.commit.slice(0, 12);
  const skipped = answer.since === undefined ? '' : `; the change since ${answer.since} skips ${answer.skipped} more`;
  return [
    `${many(answer.shards, 'shard')}, the last done ${durationText(answer.wall)} in: ` +
      `${durationText(answer.setup)} of setup and up to ${durationText(longest)} of tests each` +
      (answer.workers === undefined || answer.workers === 1
        ? '.'
        : `, about ${durationText(answer.wall - answer.setup)} on ${answer.workers} workers.`),
    `From ${many(answer.files, 'test file')}, ${durationText(total)} in all, recorded at ${at}${skipped}.`,
    reasonOf(answer),
    '',
  ].join('\n');
}

function reasonOf(answer: Extract<ShardsAnswer, { by: 'recorded' }>): string {
  switch (answer.why) {
    case 'setup': {
      const next = answer.next!.wall;
      return `One more would finish ${durationText(next)} in: ${durationText(answer.wall - next)} sooner, ` +
        `for ${durationText(answer.setup)} more of setup.`;
    }
    case 'within budget':
      return `The fewest whose last finishes within the ${durationText(answer.budget!)} budget.`;
    case 'slowest group': {
      const { file, duration, cases } = answer.slowest!;
      const slowCases = cases === undefined
        ? ''
        : `, its slowest ${cases.length === 1 ? 'case' : 'cases'} ` +
          cases.map((test) => `${test.name} ${durationText(test.duration)}`).join(', ');
      const unmet = answer.budget !== undefined && answer.wall > answer.budget
        ? ` The ${durationText(answer.budget)} budget is out of reach until that file is split.`
        : '';
      return `More shards finish no sooner: ${file} alone takes ${durationText(duration)}${slowCases}.${unmet}`;
    }
    case 'max':
      return answer.max === undefined
        ? `The most one GitHub Actions matrix starts, ${MATRIX_LIMIT}.`
        : `The most \`--max ${answer.max}\` allows.`;
    case 'nothing to run':
      return '';
  }
}

function matrixOf(shards: number): readonly string[] {
  return Array.from({ length: shards }, (_, at) => `${at + 1}/${shards}`);
}
