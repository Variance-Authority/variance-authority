/**
 * The half of `variance shards` that reads: the record's times, the change
 * since `--since` when one is named, and the cases of the file no shard can
 * finish before. The answer is next door in [`shards.ts`](./shards.ts).
 *
 * The times are the ones every shard of the run places its files by: the same
 * record `select` reads, this checkout's own or the mainline's from the share
 * ([`suite-times.ts`](./suite-times.ts)). With `--since`, the files the change
 * lets the run skip are left out, as the seam leaves them out inside the
 * runner, so a change that reaches no test asks for no shard.
 */

import { fileCases } from '@variance-authority/sense';
import { selectSuite } from './select-command.js';
import { formatShards, shardsAnswer, type ShardsFormat, type ShardsInput } from './shards.js';
import { suiteTimes } from './suite-times.js';

/** How many cases of the slowest file the answer names. */
const SLOWEST_CASES = 3;

export interface ShardsRequest {
  readonly cwd: string;
  readonly suite?: string;
  readonly since?: string;
  readonly setup: number;
  readonly budget?: number;
  readonly max?: number;
  readonly workers?: number;
  readonly unrecorded?: number;
  readonly format: ShardsFormat;
}

export async function shardsOutput(request: ShardsRequest): Promise<string> {
  const { cwd, suite, since, format, ...counting } = request;
  const asked = { root: cwd, ...(suite === undefined ? {} : { suite }) };
  const times = await suiteTimes(asked);
  const skipped = since === undefined || 'unread' in times
    ? undefined
    : { since, files: (await selectSuite({ ...asked, since })).skip };
  const input: ShardsInput = { times, ...counting, ...(skipped === undefined ? {} : { skipped }) };
  const answer = shardsAnswer(input);
  if (answer.by === 'recorded' && answer.slowest !== undefined) {
    const cases = fileCases(answer.recording, answer.slowest.file, SLOWEST_CASES);
    if (cases !== undefined) return formatShards(shardsAnswer({ ...input, cases }), format);
  }
  return formatShards(answer, format);
}
