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
  /** Drop what no chain in `chains` names from the parse store at `store`, past `graceMs`; how many parses went (`native/src/parse_store.rs`). */
  pruneParseStore(store: string, chains: string[], graceMs: number): number;
  /** The index turn at `path`, `holder` written beside it; `null` while another process holds it (`native/src/index_turn.rs`). */
  takeIndexTurn(path: string, holder: string): { release(): void } | null;
}

