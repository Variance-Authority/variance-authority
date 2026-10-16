import type { NativeRegion } from './native-journey.js';

/** One shard a combine read, in the order the shards were named. */
export interface NativeCombinedShard {
  readonly path: string;
  /** The commit the shard names: its coverage's, or its last-run layer's. */
  readonly commit?: string | null;
  /** The test files its coverage recorded; for a shard that measured nothing, the files its last run ran. */
  readonly files: readonly string[];
  /** Whether the shard holds coverage. */
  readonly measured: boolean;
  /** Whether the shard's cases are in the combined index: it kept a case index and observed something. */
  readonly cased: boolean;
}

/** What `combineRecords` wrote: one record, as one unsharded run of the shards would have written it. */
export interface NativeCombinedRecord {
  readonly shards: readonly NativeCombinedShard[];
  /** Test files with coverage, over every shard. */
  readonly tests: number;
  readonly modules: number;
  readonly crossings: number;
  /** Cases in the folded index; absent when no shard kept cases. */
  readonly cases?: number | null;
  readonly commit?: string | null;
  /** Files two shards' case indexes cut into different regions. */
  readonly renumbered: readonly string[];
  /** The record every shard's selection read: `none`, a `sha256:` digest, or `unknown` when a shard named none. */
  readonly read?: string | null;
  /** Shards whose record names its read `unknown`, so no read of theirs was checked against the others'. */
  readonly unchecked: readonly string[];
  /** The modules the shards describe two ways over one text, when nothing was written: fold again with their cut. */
  readonly disputed?: { readonly instrumentation: string; readonly files: readonly string[] } | null;
}

/** What the addon answers about records: combining shards, laying one over another, and joining one file's regions. */
export interface NativeRecords {
  /**
   * Fold shard records into the one record at `output`: coverage, cases and their parts, and nothing else.
   * Shards whose records name two records their runs started from fail as unstable sharding.
   * Shards that describe a module two ways over one text write nothing and name it `disputed`;
   * `cut`, a record with no tests holding the checkout's cut of those modules, settles them.
   */
  combineRecords?(paths: string[], output: string, cut?: Buffer): NativeCombinedRecord;
  /**
   * The record `current` laid over the record `previous`; `null` where `previous` measured nothing.
   * A `previous` this build cannot read, or one under other probes, throws the reason.
   * `recut` is the modules whose text moved on disk, cut again in it: a record under `current`'s probes,
   * with no tests. `readings` says, per edit keyed by `editKey`, what it reached; an edit with no reading
   * reaches every region whose text moved.
   */
  layRecords?(
    previous: Buffer,
    current: Buffer,
    options?: {
      readonly recut?: Buffer;
      readonly readings?: Readonly<Record<string, 'none' | 'bodies' | 'load'>>;
    },
  ): Buffer | null;
  /**
   * Where each region of `inventories` lands among `table`'s, one file's own cut, by position:
   * at the region of its shape, else at the innermost source region enclosing it; `null` where none does.
   */
  landRegions?(table: NativeRegion[], inventories: NativeRegion[][]): (number | null)[][];
}
