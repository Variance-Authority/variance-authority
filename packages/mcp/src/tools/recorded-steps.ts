/**
 * The Eyes journals a record keeps, read without waiting: as the archive the
 * attention tools read, and as the steps and assertions of one test.
 *
 * A question asked of the recording answers synchronously, so the record's
 * journals are joined to the cases its index names here, by the case's id; the
 * served archive reads them through the same join.
 */

// compass: variance-authority/runtime/attention

import { readFileSync } from 'node:fs';
import type { EyesArchive } from '@variance-authority/eyes';
import { createEyesArchive, parseEyesJournal } from '@variance-authority/eyes/archive';
import { decodeExecutionIndex, recordedEyesOf } from '@variance-authority/sense/test-selection';
import { RecordKeepsNoEyes } from '../record-keeps-no-eyes.js';
import { stepLine } from './attention.js';

/**
 * The Eyes journals the record held in `bytes` keeps, as the archive the
 * attention tools read; `record` names it in a refusal.
 *
 * Each journal is one attempt of one case, named by the case's id; the title
 * and the file are the case index's, read off the same bytes as the journals.
 * A record whose run did not opt into Eyes keeps no section, and that is
 * refused with {@link RecordKeepsNoEyes} rather than read as a run with no
 * tests, which is what an empty archive says.
 */
export function eyesArchiveOf(bytes: Uint8Array, record: string): EyesArchive {
  // The index first: bytes that are no record at all are refused here, not
  // taken for a record that kept no Eyes.
  const cases = new Map(decodeExecutionIndex(bytes).tests.map((test) => [test.id, test]));
  const section = recordedEyesOf(bytes);
  if (section === undefined) throw new RecordKeepsNoEyes(record);
  return createEyesArchive(section.journals.map((row) => {
    const named = cases.get(row.case);
    return {
      id: row.case,
      attempt: row.attempt,
      title: named?.name ?? row.case,
      ...(named?.file === undefined ? {} : { file: named.file }),
      ...attentionOf(row),
    };
  }), section.watched);
}

type JournalRow = NonNullable<ReturnType<typeof recordedEyesOf>>['journals'][number];

function attentionOf(row: JournalRow): ReturnType<typeof parseEyesJournal> {
  return parseEyesJournal(row.journal, `the Eyes journal of ${row.case}, attempt ${row.attempt}`);
}

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
  const journal = attentionOf(last);
  return {
    steps: journal.attention.flatMap((entry) => stepLine(entry) ?? []),
    attempt: last.attempt,
    attempts: attempts.length,
    ...(journal.complete ? {} : { partial: journal.because }),
  };
}
