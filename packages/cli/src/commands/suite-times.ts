/**
 * The times a sharded run places its test files by: the per-file durations of
 * the record `selectSuite` reads, this checkout's own or the mainline's its
 * share holds, so a shard places by the record its selection was cut from.
 *
 * Every shard reads them on its own machine. An answer every shard reads alike
 * — no share, or a share that holds no record — leaves the times unread, and
 * the shards are placed by count. A share that did not answer, or answered
 * with what does not read, may answer the next shard, so it throws, even when
 * the primary checkout's record would stand in for it.
 */

import { recordedTimes } from '@variance-authority/sense';
import type { SuiteTimes } from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';
import { mainlineMissed } from './mainline-base.js';
import { recordedOrMainline } from './select-command.js';

/** The misses every shard reads alike: nothing published, or no share configured. */
const ALIKE: ReadonlySet<string> = new Set(['absent', 'unconfigured']);

/** Where the times are read: a directory inside the checkout, and whose record. */
export interface TimesRequest {
  readonly root: string;
  readonly suite?: string;
}

/** Each recorded test file's milliseconds, or why there are none to read. */
export async function suiteTimes(request: TimesRequest): Promise<SuiteTimes> {
  const found = await recordedOrMainline(request);
  if (found.missed !== undefined && !ALIKE.has(found.missed.miss.kind)) throw new OperatorError(mainlineMissed(found.missed));
  if (!found.held) return { recording: found.at, unread: 'nothing is recorded there' };
  return recordedTimes(found.at);
}
