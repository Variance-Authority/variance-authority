/**
 * How many shards a suite is worth: the answer `variance shards` prints.
 *
 * Pure, over the times a record holds and what the change skips, so every rule
 * is assertable with no record and no repository. The count is
 * `shardCount`'s, from `@variance-authority/core/shard`, the same placement
 * every shard of the run computes for itself, so the count predicted here is
 * the count those shards split by.
 *
 * The command always answers, and an answer it could not weigh fully says what
 * it left out, in its `notes`. A suite with no times is one shard until
 * `--unrecorded <n>` names the count the operator chose for that case, and the
 * answer says where its count came from either way.
 */

import { MATRIX_LIMIT, durationText, priced, shardCount, type ShardCountReason } from '@variance-authority/core/shard';
import type { SuiteTimes } from '@variance-authority/sense/test-selection';
import { many } from './prose-counts.js';

export type ShardsFormat = 'text' | 'json';

export interface ShardsInput {
  readonly times: SuiteTimes;
  /** Milliseconds each shard spends before its first test; absent, the count weighs none. */
  readonly setup?: number;
  /** Milliseconds one shard may take, setup included. */
  readonly budget?: number;
  readonly max?: number;
  /** How many test files one shard's runner runs at once. */
  readonly workers?: number;
  /** The count to answer when nothing is recorded; absent, one. */
  readonly unrecorded?: number;
  /** The recorded files the change since `since` lets the run skip. */
  readonly skipped?: { readonly since: string; readonly files: ReadonlySet<string> };
  /**
   * The test files the runner collects, from `--collected`. Absent, the count is
   * of the files the record holds; present, of these, and one the record has not
   * seen is priced at the median of the recorded ones, as every shard prices it.
   */
  readonly collected?: ReadonlySet<string>;
  /** `--at-distance` was passed with no `--since`, so it cut nothing and the answer says so. */
  readonly uncutDistance?: boolean;
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
      /** The test files that would run. */
      readonly files: number;
      /** Of those, the ones the record has not seen, priced at the median; absent when none. */
      readonly untimed?: number;
      /** The recorded files the change skips; absent when no change was asked about. */
      /** How many test files `--collected` named; absent without it. */
      readonly collected?: number;
      readonly skipped?: number;
      readonly since?: string;
      /** Absent when no `--setup` was given, and the count weighed none. */
      readonly setup?: number;
      readonly budget?: number;
      readonly max?: number;
      readonly workers?: number;
      /** Milliseconds of tests each shard runs, shard 1 first. */
      readonly load: readonly number[];
      /** Milliseconds until the last shard finishes, setup included. */
      readonly wall: number;
      /**
       * `unlisted`: the change skips every recorded file and no `--collected`
       * says what it adds, so one shard runs whatever that is.
       */
      readonly why: ShardCountReason | 'unlisted';
      readonly next?: { readonly wall: number };
      readonly slowest?: {
        readonly file: string;
        readonly duration: number;
        readonly cases?: readonly { readonly name: string; readonly duration: number }[];
      };
      /** What the count could not weigh, one sentence each; absent when it weighed everything. */
      readonly notes?: readonly string[];
    }
  | {
      readonly shards: number;
      readonly matrix: readonly string[];
      readonly by: 'unrecorded';
      readonly recording?: string;
      readonly unread: string;
      /** Present when no `--unrecorded` chose the count, or it chose none. */
      readonly notes?: readonly string[];
    };

const UNRECORDED_NOTE = '`--unrecorded <n>` sets the count until the suite is recorded.';
const SETUP_NOTE = '`--setup` was not given, so the count does not weigh what each shard spends before its first test.';
const UNLISTED_NOTE = 'Without `--collected <file>`, only the test files the record has seen are counted.';
const NO_SHARD_NOTE = '`--unrecorded 0` would start none, and the suite still has to run.';
const UNCUT_NOTE = '`--at-distance` cuts nothing without `--since`, so the count is of the whole suite.';

export function shardsAnswer(input: ShardsInput): ShardsAnswer {
  const { times } = input;
  const unread = 'unread' in times
    ? times.unread
    : times.times.size === 0
      ? 'the record holds no time for any test file'
      : undefined;
  if ('unread' in times || unread !== undefined) {
    const shards = Math.max(input.unrecorded ?? 1, 1);
    return {
      shards,
      matrix: matrixOf(shards),
      by: 'unrecorded',
      ...(times.recording === undefined ? {} : { recording: times.recording }),
      unread: unread!,
      ...(input.unrecorded === undefined ? { notes: [UNRECORDED_NOTE] } : input.unrecorded === 0 ? { notes: [NO_SHARD_NOTE] } : {}),
    };
  }

  const setup = input.setup ?? 0;
  const unlisted = input.skipped !== undefined && input.collected === undefined;
  const notes = [
    ...(input.setup === undefined ? [SETUP_NOTE] : []),
    ...(unlisted ? [UNLISTED_NOTE] : []),
    ...(input.uncutDistance === true ? [UNCUT_NOTE] : []),
  ];
  const files = [...(input.collected ?? times.times.keys())].filter((file) => !(input.skipped?.files.has(file) ?? false));
  // Priced as the shards price what they keep. With none of it timed, they
  // fall back to the runner's split, and the record's median is the guess.
  const recorded = [...times.times].map(([key, duration]) => ({ key, costs: [duration] }));
  const unseen = (): number => priced([{ key: '', costs: [undefined] }, ...recorded])![0]!;
  const costs = priced(files.map((file) => ({ key: file, costs: [times.times.get(file)] }))) ?? files.map(unseen);
  const running = files.map((file, at) => [file, costs[at]!] as const);
  const untimed = files.filter((file) => !times.times.has(file)).length;
  // Without the runner's list, a change that skips every recorded file may
  // still add one, and one shard runs it.
  const count = unlisted && files.length === 0
    ? { shards: 1, load: [0], wall: setup, why: 'unlisted' as const }
    : shardCount(costs, {
        setup,
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
    ...(input.collected === undefined ? {} : { collected: input.collected.size }),
    ...(untimed === 0 ? {} : { untimed }),
    ...(input.skipped === undefined ? {} : { skipped: input.skipped.files.size, since: input.skipped.since }),
    ...(input.setup === undefined ? {} : { setup: input.setup }),
    ...(input.budget === undefined ? {} : { budget: input.budget }),
    ...(input.max === undefined ? {} : { max: input.max }),
    ...(input.workers === undefined ? {} : { workers: input.workers }),
    load: count.load,
    wall: count.wall,
    why: count.why,
    ...('next' in count && count.next !== undefined ? { next: count.next } : {}),
    ...(count.why !== 'slowest group' || slowest === undefined
      ? {}
      : {
          slowest: {
            file: slowest[0],
            duration: slowest[1],
            ...(input.cases === undefined || input.cases.length === 0 ? {} : { cases: input.cases }),
          },
        }),
    ...(notes.length === 0 ? {} : { notes }),
  };
}

export function formatShards(answer: ShardsAnswer, format: ShardsFormat): string {
  if (format === 'json') return `${JSON.stringify(answer, null, 2)}\n`;
  if (answer.by === 'unrecorded') {
    const where = answer.recording === undefined ? '' : ` (${answer.recording})`;
    return answer.notes === undefined
      ? `${many(answer.shards, 'shard')}, as --unrecorded says: ${answer.unread}${where}.\n`
      : `${many(answer.shards, 'shard')}: ${answer.unread}${where}. ${answer.notes.join(' ')}\n`;
  }
  const notes = answer.notes ?? [];
  if (answer.why === 'unlisted') {
    return [
      `1 shard: the change since ${answer.since} skips every recorded test file, ${answer.skipped} in all, ` +
        'and one shard runs whatever it adds.',
      ...notes,
      '',
    ].join('\n');
  }
  if (answer.why === 'nothing to run') {
    const all = answer.files + (answer.skipped ?? 0);
    const zero = answer.since === undefined
      ? answer.collected === undefined ? '0 shards: the record holds no test file to run.' : '0 shards: --collected names no test file to run.'
      : `0 shards: the change since ${answer.since} skips every recorded test file, ${all} in all.`;
    return [zero, ...notes, ''].join('\n');
  }
  const longest = Math.max(...answer.load);
  const total = answer.load.reduce((sum, load) => sum + load, 0);
  const at = answer.commit === undefined ? answer.recording : answer.commit.slice(0, 12);
  const skipped = answer.since === undefined ? '' : `; the change since ${answer.since} skips ${answer.skipped} more`;
  const untimed = answer.untimed === undefined ? '' : `; ${answer.untimed} not in the record, priced at the median`;
  return [
    `${many(answer.shards, 'shard')}, the last done ${durationText(answer.wall)} in: ` +
      `${durationText(answer.setup ?? 0)} of setup and up to ${durationText(longest)} of tests each` +
      (answer.workers === undefined || answer.workers === 1
        ? '.'
        : `, about ${durationText(answer.wall - (answer.setup ?? 0))} on ${answer.workers} workers.`),
    `From ${many(answer.files, 'test file')}, ${durationText(total)} in all, recorded at ${at}${skipped}${untimed}.`,
    reasonOf(answer),
    ...notes,
    '',
  ].join('\n');
}

/** The longest case name the text prints whole; a parametrised name can run to hundreds. */
const CASE_NAME_LIMIT = 80;

function reasonOf(answer: Extract<ShardsAnswer, { by: 'recorded' }>): string {
  switch (answer.why) {
    case 'setup': {
      const next = answer.next!.wall;
      return `One more would finish ${durationText(next)} in: ${durationText(answer.wall - next)} sooner, ` +
        `for ${durationText(answer.setup ?? 0)} more of setup.`;
    }
    case 'within budget':
      return `The fewest whose last finishes within the ${durationText(answer.budget!)} budget.`;
    case 'slowest group': {
      const { file, duration, cases } = answer.slowest!;
      // One case, named short: the JSON answer keeps the slowest cases whole.
      const slowest = cases?.[0];
      const slowCases = slowest === undefined
        ? ''
        : `, its slowest case ${clipped(slowest.name, CASE_NAME_LIMIT)} ${durationText(slowest.duration)}`;
      const unmet = answer.budget !== undefined && answer.wall > answer.budget
        ? ` The ${durationText(answer.budget)} budget is out of reach until that file is split.`
        : '';
      return `More shards finish no sooner: ${file} alone takes ${durationText(duration)}${slowCases}.${unmet}`;
    }
    case 'setup over budget':
      return `The ${durationText(answer.budget!)} budget is out of reach: each shard spends ` +
        `${durationText(answer.setup ?? 0)} of setup alone before its first test.`;
    case 'max':
      return answer.max === undefined
        ? `The most one GitHub Actions matrix starts, ${MATRIX_LIMIT}.`
        : `The most \`--max ${answer.max}\` allows.`;
    case 'nothing to run':
    case 'unlisted':
      return '';
  }
}

const CHARACTERS = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Cut between the characters a reader sees, so an emoji in a case name is never halved. */
function clipped(text: string, limit: number): string {
  const characters = Array.from(CHARACTERS.segment(text), (part) => part.segment);
  return characters.length <= limit ? text : `${characters.slice(0, limit - 1).join('').trimEnd()}…`;
}

function matrixOf(shards: number): readonly string[] {
  return Array.from({ length: shards }, (_, at) => `${at + 1}/${shards}`);
}
