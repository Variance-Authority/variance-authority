import type { NativeRegion } from './native-journey.js';
import type { NativeRunCrossed } from './native-run-crossings.js';

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

/**
 * One run's coverage as columns, for `encodeCoverage`: words already the record's, and a region's
 * crossers named by index into `members`. Each `*Offsets` column, and `testPreconditions` and
 * `moduleBlocks`, holds one more entry than the rows it splits.
 */
export interface NativeCoverageRows {
  readonly instrumentation: string;
  readonly commit?: string;
  readonly testPath: string[];
  readonly testComplete: Uint8Array;
  readonly testDuration: Uint32Array;
  readonly testPhases: Uint32Array;
  readonly testPreconditions: Uint32Array;
  readonly preconditionName: string[];
  readonly preconditionDigest: string[];
  readonly modulePath: string[];
  readonly moduleSource: string[];
  readonly moduleBlob: (string | null)[];
  readonly moduleInstrumented: Uint8Array;
  readonly moduleBlocks: Uint32Array;
  readonly blockOrdinal: Uint32Array;
  readonly blockKind: Uint8Array;
  readonly blockOwner: Uint32Array;
  readonly blockDigest: string[];
  readonly blockName: string[];
  readonly blockPath: string[];
  readonly blockStart: Uint32Array;
  readonly blockEnd: Uint32Array;
  readonly blockSource: Uint8Array;
  readonly members: string[];
  readonly calledOffsets: Uint32Array;
  readonly called: Uint32Array;
  readonly loadedOffsets: Uint32Array;
  readonly loaded: Uint32Array;
  /** A run's crossings, read in place of `members`, `called` and `loaded`, which are then empty. */
  readonly crossed?: NativeRunCrossed;
}

/** What the addon answers about records: combining shards, laying one over another, and joining one file's regions. */
export interface NativeRecords {
  /**
   * The coverage record `rows` describe: tests and modules by path, regions by ordinal, preconditions
   * and crossers sorted and distinct. A test file twice, or a crosser no test row holds, throws.
   */
  encodeCoverage?(rows: NativeCoverageRows): Buffer;
  /**
   * What each test file of `rows` ran over, as `[file, digest]` in row order: every module some
   * region of which it crossed or loaded, at its source digest, and its preconditions.
   */
  coverageInputs?(rows: NativeCoverageRows): string[][];
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
   * The case readings section once a run is laid over the record's, as `layReadings` documents it;
   * `null` when nothing is left to write. `fresh` absent is no run; `same` the files the run recorded
   * from the text the landed index holds, and `inputs` each test file's `[file, digest]`.
   */
  layReadings?(
    kept: Buffer | undefined,
    previous: Buffer | undefined,
    landed: Buffer | undefined,
    cases: string[],
    fresh: Buffer | undefined,
    announced: string[],
    same: string[],
    inputs: [string, string][] | undefined,
  ): Buffer | null;
  /**
   * Every reading `section` keeps of case `id`, newest first, as `readingsOf` documents it; `null`
   * when it keeps none of the case. A region's value is absent where the case's lines name none.
   */
  readingsOfCase?(
    section: Buffer,
    index: Buffer | undefined,
    id: string,
  ): { count: number; stopped?: boolean; regions: { module: string; name: string; path: string; start: number; end: number; value?: number }[] }[] | null;
  /**
   * The regions case `id` crossed as `index` holds its newest run, as `newestRegions` documents it;
   * `null` when the index holds no such case.
   */
  newestRegionsOfCase?(
    index: Buffer,
    id: string,
  ): { module: string; name: string; path: string; start: number; end: number; value?: number }[] | null;
  /**
   * Where each region of `inventories` lands among `table`'s, one file's own cut, by position:
   * at the region of its shape, else at the innermost source region enclosing it; `null` where none does.
   */
  landRegions?(table: NativeRegion[], inventories: NativeRegion[][]): (number | null)[][];
}
