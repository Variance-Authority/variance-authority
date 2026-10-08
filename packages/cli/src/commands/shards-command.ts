/**
 * The half of `variance shards` that reads: the record's times, the change
 * since `--since` when one is named, and the cases of the file no shard can
 * finish before. The answer is next door in [`shards.ts`](./shards.ts).
 *
 * The times are the ones every shard of the run places its files by: the same
 * record `select` reads, this checkout's own or the mainline's from the share
 * ([`suite-times.ts`](./suite-times.ts)). With `--since`, the files the change
 * lets the run skip are left out, as the seam leaves them out inside the
 * runner, and with `--at-distance` so are the files outside that leg, so a
 * change that reaches no test asks for no shard. The runner's list
 * (`--collected`) is what makes that 0 true: the record holds only the files it
 * has seen, and a test file the change adds runs on a shard all the same, so
 * without the list the answer is never fewer than one.
 */

import { fileCases } from '@variance-authority/sense';
import { selectSuite } from './select-command.js';
import { formatShards, shardsAnswer, type ShardsFormat, type ShardsInput } from './shards.js';
import { collectedIn } from './suite-share.js';
import { suiteTimes } from './suite-times.js';

/** How many cases of the slowest file the answer names. */
const SLOWEST_CASES = 3;

export interface ShardsRequest {
  readonly cwd: string;
  readonly suite?: string;
  readonly since?: string;
  /** The runner's list of test files, read as `share --collected` reads it. */
  readonly collected?: string;
  /** The leg of the selection to count, as `select --at-distance` cuts it. */
  readonly atDistance?: { readonly from: number; readonly to: number };
  readonly setup?: number;
  readonly budget?: number;
  readonly max?: number;
  readonly workers?: number;
  readonly unrecorded?: number;
  readonly format: ShardsFormat;
}

export async function shardsOutput(request: ShardsRequest): Promise<string> {
  const { cwd, suite, since, collected: listed, atDistance, format, ...counting } = request;
  const asked = { root: cwd, ...(suite === undefined ? {} : { suite }) };
  const times = await suiteTimes(asked);
  const skipped = since === undefined || 'unread' in times
    ? undefined
    : { since, files: (await selectSuite({ ...asked, since, ...(atDistance === undefined ? {} : { atDistance }) })).skip };
  const collected = listed === undefined || 'unread' in times ? undefined : await collectedIn(cwd, listed);
  const input: ShardsInput = {
    times,
    ...counting,
    ...(skipped === undefined ? {} : { skipped }),
    ...(collected === undefined ? {} : { collected }),
    ...(atDistance !== undefined && since === undefined ? { uncutDistance: true } : {}),
  };
  const answer = shardsAnswer(input);
  if (answer.by === 'recorded' && answer.slowest !== undefined) {
    const cases = fileCases(answer.recording, answer.slowest.file, SLOWEST_CASES);
    if (cases !== undefined) return formatShards(shardsAnswer({ ...input, cases }), format);
  }
  return formatShards(answer, format);
}
