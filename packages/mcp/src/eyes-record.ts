// compass: variance-authority/runtime/attention
import { readFile } from 'node:fs/promises';
import { createEyesArchive, type EyesArchive } from '@variance-authority/eyes';
import { parseEyesJournal } from '@variance-authority/eyes/archive';
import { decodeExecutionIndex, recordedEyesOf } from '@variance-authority/sense/test-selection';

/**
 * A record that reads, written by a run that did not opt into Eyes. Distinct
 * from a record that does not read, which a reload rides out.
 */
export class RecordKeepsNoEyes extends Error {
  constructor(readonly record: string) {
    super(`the record at ${record} keeps no Eyes journals: the run that wrote it did not opt into Eyes`);
  }
}

/**
 * The Eyes journals a record keeps, as the archive the attention tools read.
 *
 * Each journal is one attempt of one case, named by the case's id; the title
 * and the file are the case index's, read off the same bytes as the journals.
 * A record whose run did not opt into Eyes keeps no section, and that is
 * refused with {@link RecordKeepsNoEyes} rather than read as a run with no
 * tests, which is what an empty archive says.
 */
export async function readEyesRecord(record: string): Promise<EyesArchive> {
  const bytes = await readFile(record);
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
      ...parseEyesJournal(row.journal, `the Eyes journal of ${row.case}, attempt ${row.attempt}`),
    };
  }), section.watched);
}
