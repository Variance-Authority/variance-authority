/**
 * The times a sharded run places its test files by: the per-file durations of
 * the record `selectSuite` reads, this checkout's own or the mainline's its
 * share holds, so a shard places by the record its selection was cut from.
 */

import { recordedTimes } from '@variance-authority/sense';
import type { SuiteTimes } from '@variance-authority/sense/test-selection';
import { recordedOrMainline } from './select-command.js';

/** Where the times are read: a directory inside the checkout, and whose record. */
export interface TimesRequest {
  readonly root: string;
  readonly suite?: string;
}

/** Each recorded test file's milliseconds, or why there are none to read. */
export async function suiteTimes(request: TimesRequest): Promise<SuiteTimes> {
  const found = await recordedOrMainline(request);
  if (!found.held) return { recording: found.at, unread: 'nothing is recorded there' };
  return recordedTimes(found.at);
}
