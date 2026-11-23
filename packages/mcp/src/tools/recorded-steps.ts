/**
 * The steps and assertions one test's Eyes journal keeps, read without
 * waiting: a question asked of the recording answers synchronously.
 */

// compass: variance-authority/runtime/attention

import { readFileSync } from 'node:fs';
import { parseJournalRow } from '@variance-authority/eyes/archive';
import { recordedEyesOf } from '@variance-authority/sense/test-selection';
import { stepLine } from './attention.js';

type JournalRow = NonNullable<ReturnType<typeof recordedEyesOf>>['journals'][number];

/** What one test's journal says it did, or why there is no journal to say it. */
export type RecordedSteps =
  | {
      /** Why no step or assertion of the test is recorded; never that it makes none. */
      readonly unrecorded: string;
    }
  | {
      /** Each step and assertion the journal recorded, in the order the test made them. */
      readonly steps: readonly string[];
      /** The attempt they are read from, the last one the journals hold. */
      readonly attempt: number;
      /** How many attempts kept a journal; fewer than `attempt` when one kept none. */
      readonly attempts: number;
      /** Why the journal is not whole, when it is not. */
      readonly partial?: string;
    };

/**
 * The steps and assertions the record at `record` keeps for the case it names
 * `id`, from its last attempt: a retried test's earlier attempts are the runs
 * it did not pass on. The id, not the file and the name, because one test run
 * under two projects is two cases with the same file and name.
 */
export function recordedSteps(record: string, id: string): RecordedSteps {
  // The record's cases were read by the question that names `id`, so only the journals are read here, and only its own parsed.
  const section = recordedEyesOf(readFileSync(record));
  if (section === undefined) return { unrecorded: 'the run kept no Eyes journal' };
  const attempts = section.journals.filter((row) => row.case === id);
  const last = attempts.reduce<JournalRow | undefined>((latest, row) => (latest === undefined || row.attempt > latest.attempt ? row : latest), undefined);
  if (last === undefined) {
    // A producer that names no watched case watched every one.
    return { unrecorded: section.watched === undefined || section.watched.includes(id) ? 'Eyes watched it and kept no journal' : 'Eyes did not watch it' };
  }
  const journal = parseJournalRow(last);
  return {
    steps: journal.attention.flatMap((entry) => stepLine(entry) ?? []),
    attempt: last.attempt,
    attempts: attempts.length,
    ...(journal.complete ? {} : { partial: journal.because }),
  };
}
