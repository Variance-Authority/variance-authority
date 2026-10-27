// compass: variance-authority.reach
/**
 * How far the record `covering` answers from is behind the checkout.
 *
 * Every range is painted from a record made at one commit onto the text at
 * another, and *written since the recording* reads the same one commit on as
 * two thousand. So an answer read from a record names the record's commit and
 * how many commits `HEAD` is past it, in the words `review` places the
 * mainline's record in (`describeDistance`).
 */

import { recordedCommit } from '@variance-authority/sense/test-selection';
import type { CoveringSource } from '../covering-args.js';
import { distanceBetween } from '../share-lines.js';
import { snapshotFor } from './covering-frame.js';
import { describeDistance } from './share.js';

/**
 * The commit the record at `from` was made at, when it says: only an index
 * read from beside a snapshot names one, since a journey file handed in by
 * path is no record of a commit.
 */
export async function recordCommitOf(request: CoveringSource, from: string): Promise<string | undefined> {
  const record = await snapshotFor(request);
  return record !== undefined && from.startsWith(record) ? recordedCommit(record) : undefined;
}

/**
 * The record's commit and how many commits `HEAD` is past it: negative when
 * the record is newer, absent when this clone cannot count. Nothing when the
 * record names no commit.
 */
export async function behindHead(root: string, at: string | undefined): Promise<{ readonly at?: string; readonly distance?: number }> {
  if (at === undefined) return {};
  const distance = await distanceBetween(at, 'HEAD', root);
  return distance === undefined ? { at } : { at, distance };
}

/** The line that places the record, said under every answer read from one that names its commit. */
export function behindText(answer: { readonly at?: string; readonly distance?: number }): readonly string[] {
  if (answer.at === undefined) return [];
  return [`The record was made at ${answer.at.slice(0, 12)}, ${describeDistance(answer.distance, 'HEAD')}.`];
}
