// compass: variance-authority.reach
/**
 * The runs record a question reads: the one beside the snapshot it asks, read
 * once however many of its readers ask, with the checkout it is placed in.
 *
 * Sense owns the record's shape and its parse (`readCommitRuns`); finding the
 * file beside the snapshot `--execution` names and holding the read for the
 * length of one question is the command's. A record that cannot be read is a
 * value, not a throw, so each reader decides: a comparison refuses it
 * (`carriedOver`), and the place reading names it.
 */

import { readCommitRuns, type CommitRuns } from '@variance-authority/sense/test-selection';
import { topLevel } from './since.js';

/**
 * The runs record beside the record at `record`, with the checkout it is
 * placed in. A runs record that is there and cannot be read is held as
 * `unread`, not thrown.
 */
export interface RecordRuns {
  readonly record: string;
  /** The checkout's top level, absent when `root` is in none. */
  readonly repository?: string;
  /** Absent when no run has listed itself beside the record. */
  readonly runs?: CommitRuns;
  /** Why the runs record that is there does not read. */
  readonly unread?: Error;
}

/** {@link RecordRuns} for the record at `record`, never thrown. */
export async function runsOf(record: string, root: string): Promise<RecordRuns> {
  const repository = await topLevel(root);
  const at = { record, ...(repository === undefined ? {} : { repository }) };
  try {
    const runs = await readCommitRuns(record);
    return { ...at, ...(runs === undefined ? {} : { runs }) };
  } catch (error) {
    return { ...at, unread: error instanceof Error ? error : new Error(String(error)) };
  }
}

/** The one read of a record's runs a question makes, made when first asked for. */
export type RunsRead = () => Promise<RecordRuns>;

/** A {@link RunsRead} of the record at `record` that reads it once, however often it is asked. */
export function runsOnce(record: string, root: string): RunsRead {
  let read: Promise<RecordRuns> | undefined;
  return () => (read ??= runsOf(record, root));
}
