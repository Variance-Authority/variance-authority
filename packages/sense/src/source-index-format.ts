import type { Digest } from '@variance-authority/core/format';
import type { FileRecord } from '@variance-authority/core/relate';
import type { Parsed, ParseKey } from './cache.js';
import { native, nativeRefusal } from './addon.js';
import type { NativeScanner } from './native.js';

/**
 * One durable generation of source facts: its shape, and the documents it is
 * written from.
 *
 * The addon owns the bytes: it writes them (`native/src/generation.rs`) and is
 * their one reader (`native/src/index_reader.rs`, opened by
 * [`source-index-reader.ts`](./source-index-reader.ts)). This file hands it
 * documents shaped as {@link StoredSourceIndex}, which keeps the two absences
 * the format holds apart — a parse that recorded no exports against one that
 * was never asked for them.
 */
/** The format version the addon writes and reads (`VERSION` in `native/src/segment.rs`). */
export const SOURCE_INDEX_VERSION = 54;
const WHAT = 'source index';
/** Rows per document: a few megabytes of JSON, far under any string limit. */
const ROWS = 4096;

/** A record, and the directories whose contents could still change its edges. */
export interface IndexedRecord {
  readonly record: FileRecord;
  /** Repo-relative directories, sorted ([`witness.ts`](./witness.ts)). */
  readonly witnesses: readonly string[];
  /** Resolved target for each request in the matching parse, preserving order. */
  readonly targets?: readonly (string | undefined)[];
}

export interface StoredSourceIndex {
  readonly parses: ReadonlyMap<ParseKey, Parsed>;
  readonly deletedParses?: ReadonlySet<ParseKey>;
  /** How resolution was configured when these records were built. */
  readonly config?: Digest;
  /** Every directory the tree held, named by the entries it held. */
  readonly directories: ReadonlyMap<string, Digest>;
  readonly deletedDirectories?: ReadonlySet<string>;
  readonly records: ReadonlyMap<string, IndexedRecord>;
  readonly deletedRecords?: ReadonlySet<string>;
}

/**
 * One generation as bytes, written by the addon (`encode_source_index` in
 * `native/src/graph_index.rs`) from {@link sourceIndexDocuments}. It is the only
 * encoder: a cold build's closure is encoded on that side, and a warm save's
 * delta crosses to it rather than keep a second copy of the layout here.
 */
export function encodeSourceIndex(stored: StoredSourceIndex): Buffer {
  return encoder().encodeSourceIndex(sourceIndexDocuments(stored));
}

function encoder(): NativeScanner {
  const addon = native();
  if (addon === undefined) {
    throw new Error(`the ${WHAT} is encoded by the native addon, which did not load: ${nativeRefusal()}`);
  }
  return addon;
}

/**
 * `stored` as the JSON documents the addon reads it from (`Delta` in
 * `native/src/generation.rs`): what it deletes and its configuration first,
 * then its rows, at most {@link ROWS} to a document.
 *
 * Several and not one, because one is a string the size of the whole index,
 * and V8 refuses a string past half a gigabyte: the records and parses of a
 * hundred thousand files were 290 MB of it already. An absent target crosses
 * as `null`, which the addon reads as absent.
 */
export function sourceIndexDocuments(stored: StoredSourceIndex): string[] {
  const documents = [JSON.stringify({
    ...(stored.config === undefined ? {} : { config: stored.config }),
    deletedParses: [...stored.deletedParses ?? []],
    deletedRecords: [...stored.deletedRecords ?? []],
    deletedDirectories: [...stored.deletedDirectories ?? []],
  })];
  const rows = (name: string, entries: Iterable<readonly [string, unknown]>): void => {
    let batch: (readonly [string, unknown])[] = [];
    for (const entry of entries) {
      batch.push(entry);
      if (batch.length < ROWS) continue;
      documents.push(JSON.stringify({ [name]: batch }));
      batch = [];
    }
    if (batch.length > 0) documents.push(JSON.stringify({ [name]: batch }));
  };
  rows('directories', stored.directories);
  rows('records', stored.records);
  rows('parses', stored.parses);
  return documents;
}
