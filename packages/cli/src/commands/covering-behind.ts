// compass: variance-authority.reach
/**
 * Where the record `covering` answers from stands to the checkout.
 *
 * Every range is painted from a record made at one commit onto the text at
 * another, and *written since the recording* reads the same one commit on as
 * two thousand. So an answer read from a record names the record's commit and
 * places it against `HEAD`, in the words the report source places a branch
 * record in (`beforeHead`).
 */

import { recordedCommit } from '@variance-authority/sense/test-selection';
import type { CoveringSource } from '../covering-args.js';
import { beforeHead, besideHead } from '../share-lines.js';
import { snapshotFor } from './covering-frame.js';

/** The record's commit, and how many commits `HEAD` and it each hold that the other does not, when this clone can count. */
export interface RecordPlace {
  readonly at?: string;
  readonly behind?: number;
  readonly ahead?: number;
}

/**
 * The commit the record at `from` was made at, when it says: only an index
 * read from beside a snapshot names one, since a journey file handed in by
 * path is no record of a commit.
 */
export async function recordCommitOf(request: CoveringSource, from: string): Promise<string | undefined> {
  const record = await snapshotFor(request);
  return record !== undefined && from.startsWith(record) ? recordedCommit(record) : undefined;
}

/** The record's commit placed against `HEAD`. Nothing when the record names no commit. */
export async function placeRecord(root: string, at: string | undefined): Promise<RecordPlace> {
  if (at === undefined) return {};
  const beside = await besideHead(at, root);
  return beside === undefined ? { at } : { at, ...beside };
}

/** The line that places the record, said under every answer read from one that names its commit. */
export function placeText(answer: RecordPlace): readonly string[] {
  if (answer.at === undefined) return [];
  return [`The record was made at ${answer.at.slice(0, 12)}, ${placed(answer.behind, answer.ahead)}.`];
}

function placed(behind: number | undefined, ahead: number | undefined): string {
  if (behind === undefined || ahead === undefined) return 'which this clone cannot count to HEAD: it does not hold the commit, or its history is too shallow to walk';
  if (ahead === 0) return beforeHead(behind);
  if (behind === 0) return `${String(ahead)} commit(s) past HEAD, which this checkout does not contain`;
  return `which this checkout does not contain: HEAD holds ${String(behind)} commit(s) the record does not, and the record ${String(ahead)} that HEAD does not`;
}
