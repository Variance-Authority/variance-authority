// compass: variance-authority/runtime/attention
import { readFile } from 'node:fs/promises';
import type { EyesArchive } from '@variance-authority/eyes';

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
 * The Eyes journals a record keeps, as the archive the attention tools read;
 * `eyesArchiveOf` says how they are joined to the record's cases, and refuses a
 * record whose run did not opt into Eyes with {@link RecordKeepsNoEyes}.
 *
 * The reader is imported here rather than at the top: this function is
 * exported from the root entry beside pure functions, and a caller that never
 * reads a record does not pay for Eyes or the record reader.
 */
export async function readEyesRecord(record: string): Promise<EyesArchive> {
  const [{ eyesArchiveOf }, bytes] = await Promise.all([import('./tools/recorded-steps.js'), readFile(record)]);
  return eyesArchiveOf(bytes, record);
}
