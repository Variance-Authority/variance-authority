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
  /** Start the chain at `path` as a copy of the one at `from`, when `path` has none; whether it did. */
  seedSourceIndex(path: string, from: string): boolean;
  /** Drop what no chain in `chains` names from the parse store at `store`, past `graceMs`; how many parses went (`native/src/parse_store.rs`). */
  pruneParseStore(store: string, chains: string[], graceMs: number): number;
  /** The index turn at `path`, `holder` written beside it; `null` while another process holds it (`native/src/index_turn.rs`). */
  takeIndexTurn(path: string, holder: string): { release(): void } | null;
}

/**
 * What a listing of a checkout knows of the parses made from its files: which
 * were made from the blob git names the file by, and so may be offered to
 * another checkout (`native/src/parse_origin.rs`). `Scan` is the free batch's
 * signature, `NativeScanner.scanBatch`.
 */
export interface NativeParseOrigins<Scan> {
  /** The free batch, with each file it reads told from the blob the listing names. */
  scanDisk: Scan;
  /** Tell the listing of a parse made in JavaScript of `file`, from `contents`. */
  parsedFrom(file: string, contents: string): void;
  /**
   * Add to the first of `stores` every parse the chain at `chain` holds, no
   * store does, and this listing's reads made from the blob it is kept under;
   * how many went in.
   */
  fillParseStore(stores: string[], chain: string): number;
}
