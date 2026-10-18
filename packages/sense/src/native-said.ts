/**
 * What a case said, as the addon's `case_said.rs` answers it. Every call speaks
 * a frame field's JSON, `[[name, value, site, level], …]`.
 */

/** A crossing-set pool with the `tests.said` section laid into it. */
export interface NativeSaidLaid {
  /** Absent when no case was listened to. */
  readonly section: Buffer | null;
  readonly bytes: Buffer;
  readonly offsets: Uint32Array;
}

export interface NativeSaid {
  /**
   * What one case's frame fields or held rows said, joined; `null` where none was listened to.
   * Sites are named from the checkout at `root` when given.
   */
  saidJoined?(root: string | null, said: (string | null)[]): string | null;
  /** A call site named from the checkout at `root`, as every row names it. */
  saidSite?(root: string, site: string): string;
  /** The row a reader prints for what a case said: per name, the narrowest level's values. */
  saidResolved?(said: string): string;
  /** The `tests.said` section for each case's said, its sets interned into the crossing-set pool. */
  saidLaid?(said: (string | null)[], bytes: Buffer, offsets: Uint32Array, testCount: number): NativeSaidLaid;
  /** What each case said, off a `tests.said` section and its pool; `null` for a case never listened to. */
  saidRead?(section: Buffer, bytes: Buffer, offsets: Uint32Array, testCount: number): (string | null)[];
}
