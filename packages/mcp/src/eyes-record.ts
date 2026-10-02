// compass: variance-authority/runtime/attention
import { readFile } from 'node:fs/promises';
import { createEyesArchive, type EyesArchive } from '@variance-authority/eyes';
import { parseEyesJournal } from '@variance-authority/eyes/archive';
import { decodeExecutionIndex, keepsEyes, recordedEyesAt } from '@variance-authority/sense/test-selection';

/**
 * The Eyes journals a record keeps, as the archive the attention tools read.
 *
 * Each journal is one attempt of one case, named by the case's id; the title
 * and the file are the case index's. A record whose run did not opt into Eyes
 * keeps no section, and that is refused rather than read as a run with no
 * tests, which is what an empty archive says.
 */
export async function readEyesRecord(record: string): Promise<EyesArchive> {
  const bytes = await readFile(record);
  if (!keepsEyes(record)) {
    throw new Error(`the record at ${record} keeps no Eyes journals: the run that wrote it did not opt into Eyes`);
  }
  const section = recordedEyesAt(record);
  if (section === undefined) throw new Error(`the record at ${record} keeps an Eyes section that does not read`);
  const cases = new Map(decodeExecutionIndex(bytes).tests.map((test) => [test.id, test]));
  return createEyesArchive(section.journals.map((row) => {
    const named = cases.get(row.case);
    return {
      id: row.case,
      attempt: row.attempt,
      title: named?.name ?? row.case,
      ...(named?.file === undefined ? {} : { file: named.file }),
      ...parseEyesJournal(row.journal, `the Eyes journal of ${row.case}, attempt ${row.attempt}`),
    };
  }));
}
