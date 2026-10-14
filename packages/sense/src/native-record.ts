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
}
