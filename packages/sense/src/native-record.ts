import type { NativeReconciledRegions, NativeRegion } from './native-journey.js';

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

/** What the addon answers about records: combining shards, laying one over another, and joining one file's regions. */
export interface NativeRecords {
  /**
   * Fold shard records into the one record at `output`: coverage, cases and their parts, and nothing else.
   * `starts` names, by position, the commit each shard's runs record says its run was laid over.
   */
  combineRecords?(paths: string[], output: string, starts?: (string | null)[]): NativeCombinedRecord;
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
  /** Several inventories of one source text, read at the regions they all hold. */
  reconcileRegions?(inventories: NativeRegion[][]): NativeReconciledRegions;
}
