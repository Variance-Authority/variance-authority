// compass: variance-authority.reach.source-index
import type { FileRecord } from '@variance-authority/core/relate';
/** The format version the native source owner reads and writes. */
export const SOURCE_INDEX_VERSION = 48;
/** Resolution metadata for an in-memory record supplied by a caller. */
export interface IndexedRecord {
  readonly record: FileRecord;
  readonly witnesses: readonly string[];
  readonly targets?: readonly (string | undefined)[];
}
