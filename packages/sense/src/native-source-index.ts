/**
 * The source index's chain and the cache's parse store, as the addon writes
 * them: every append, seed, fill and prune goes through these, so the addon is
 * the only writer of either log.
 */

// compass: variance-authority.reach.source-index

export interface NativeSourceIndexes {
  /**
   * A source-index generation as bytes, from the JSON documents
   * `sourceIndexDocuments` writes of it. The only encoder of the format.
   */
  encodeSourceIndex(documents: string[]): Buffer;
  /**
   * Write a save's `layers` over the source-index chain at `path`, as the save
   * read it: the first `read.length` segments its manifest names, or the legacy
   * single-segment file when `legacy`. The addon decides what the next manifest
   * names (`native/src/append_index.rs`) and is the only writer of the chain.
   * Why the layers were not written, or `null` when they are.
   */
  appendSourceIndex(path: string, read: string[], legacy: boolean, layers: Uint8Array[]): string | null;
  /**
   * The source-index chain `segments` holds, oldest first, opened once
   * (`native/src/index_reader.rs`): the one reader of the format.
   */
  openSourceIndexReader(segments: Uint8Array[]): NativeSourceIndexReader;
  /** Drop what no chain in `chains` names from the parse store at `store`, past `graceMs`; how many parses went (`native/src/parse_store.rs`). */
  pruneParseStore(store: string, chains: string[], graceMs: number): number;
  /** The index turn at `path`, `holder` written beside it; `null` while another process holds it (`native/src/index_turn.rs`). */
  takeIndexTurn(path: string, holder: string): { release(): void } | null;
}


/**
 * One opened chain. A question about keys or counts decodes no row; a row
 * crosses as JSON shaped as JavaScript holds it, and `null` is absent.
 */
export interface NativeSourceIndexReader {
  /** How many of the chain's oldest segments read; the rest are dropped. */
  kept(): number;
  /** The format version of the segment that stopped the read, when another release wrote it. */
  written(): number | null;
  /** The newest kept layer's configuration. */
  config(): string | null;
  /** Every directory and its digest, flattened: path, digest, path, … */
  directories(): string[];
  parseCount(): number;
  parseKeys(): string[];
  hasParse(key: string): boolean;
  parse(key: string): string | null;
  /** `[key, parse]` pairs from `start`, at most `count` of them, as one JSON array. */
  parses(start: number, count: number): string;
  recordCount(): number;
  recordFiles(): string[];
  hasRecord(file: string): boolean;
  record(file: string): string | null;
  /** `[file, record]` pairs from `start`, at most `count` of them, as one JSON array. */
  records(start: number, count: number): string;
}
