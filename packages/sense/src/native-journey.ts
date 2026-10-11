/**
 * What the native scanner's journey calls take and answer: the graph a
 * selection walks, a change, and the counts and names a fold or stitch reports.
 */

export interface NativeJourneyGraph {
  readonly names: readonly string[];
  readonly kinds: Uint8Array;
  readonly dependsOffset: Uint32Array;
  readonly dependsTarget: Uint32Array;
  readonly dependsKind: Uint8Array;
  readonly dependentsOffset: Uint32Array;
  readonly dependentsTarget: Uint32Array;
  readonly dependentsKind: Uint8Array;
  /** The `EDGE_KINDS` indices a runtime walk follows. */
  readonly through: readonly number[];
  readonly shadows: readonly { readonly file: string; readonly shadows: readonly string[] }[];
}

export interface NativeJourneySelection {
  readonly whole: readonly string[];
  readonly entered: readonly string[];
  readonly unread: readonly string[];
  /** Absent from an addon built before a suite could decline relations. */
  readonly declined?: readonly string[];
}

export interface NativeJourneyChange {
  readonly file: string;
  /** Flat inclusive `[start, end]` pairs; empty names the whole file. */
  readonly ranges: number[];
  /** What reading the file's two texts proved, `none` or `bodies`; absent when none was made. */
  readonly read?: string;
}

export interface NativeJourneyProjection {
  readonly tests: readonly {
    readonly id: string;
    readonly file: string;
    readonly name: string;
    readonly stopped?: boolean | null;
    /** The case's preconditions as `tests.casePreconditions` spells them; absent where nobody listened. */
    readonly preconditions?: string | null;
  }[];
  readonly modules: readonly {
    readonly file: string;
    readonly blocks: readonly {
      readonly kind: string;
      readonly name: string;
      readonly path: string;
      readonly startLine: number;
      readonly endLine: number;
      readonly source: boolean;
      readonly loaded: boolean;
      readonly tests: readonly number[];
    }[];
  }[];
  /** Every file the journey holds a row for. */
  readonly files: readonly string[];
}

/** One module a run's cases named, cut again from the checkout, as the fold reads it. */
export interface NativeJourneyModule {
  readonly id: string;
  readonly file: string;
  /** In ordinal order; empty for a module whose ordinals cannot be read. */
  readonly blocks: readonly {
    readonly kind: string;
    readonly name: string;
    readonly path: string;
    /** Zero for a region with no line of any file. */
    readonly startLine: number;
    readonly endLine: number;
    readonly source: boolean;
  }[];
  /**
   * Each region's owner, as its position among `blocks`, always before it, or
   * `NO_OWNER`; absent where the cut named none.
   */
  readonly owners?: readonly number[];
}

export interface NativeJourneyFold {
  readonly bytes: Buffer;
  readonly tests: number;
  readonly modules: number;
  readonly crossings: number;
  readonly passes: number;
  /** Modules a case ran that no record holds: a change there selects nothing. */
  readonly unrecorded: readonly string[];
  /** Part files that ran code under no journey a case handed out. */
  readonly unclaimed: readonly string[];
  /** Heads that wrote parts in the run before and none in this one; absent with no run before. */
  readonly silent?: readonly string[];
}

export type NativeJourneyFoldResult = Omit<NativeJourneyFold, 'bytes'>;

export interface NativeJourneyStitch {
  readonly bytes: Buffer;
  readonly tests: number;
  readonly modules: number;
  readonly crossings: number;
  readonly shards: number;
  /** Files two shards cut into different regions, read at the regions both hold. */
  readonly renumbered: readonly string[];
  /** Over every shard; absent when a shard does not carry them. */
  readonly unrecorded?: readonly string[];
  /** Over every shard; absent when a shard does not carry them. */
  readonly unclaimed?: readonly string[];
  /** Over every shard; absent when a shard had no run before to compare with. */
  readonly silent?: readonly string[];
}

export type NativeJourneyStitchResult = Omit<NativeJourneyStitch, 'bytes'>;
