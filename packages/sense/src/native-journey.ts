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
    /** Every item the case said, unresolved, as `tests.said` holds them; absent where nobody listened. */
    readonly said?: string | null;
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
      /** The cases whose crossing of the region is not known, none of them in `tests`; absent from an addon built before it carried them. */
      readonly overwritten?: readonly number[];
    }[];
  }[];
  /** Every file the journey holds a row for. */
  readonly files: readonly string[];
}

/** One region of a module, as the transform that placed its probes cut it. */
export type NativeRegion = NativeJourneyModule['blocks'][number];

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

/** One run's case journals, read once into the cases they name (`native/src/case_run.rs`). */
/**
 * The modules a case fold is over, as columns: a region's kind, name and path
 * are indexes into `strings`, each string handed over once; `blocks` says where
 * each module's regions start, one more entry than modules; an owner is the
 * region's position among its module's regions, or `NO_OWNER`.
 */
export interface NativeFoldModules {
  ids: string[];
  files: string[];
  blocks: Uint32Array;
  ordinal: Uint32Array;
  kind: Uint32Array;
  name: Uint32Array;
  path: Uint32Array;
  start: Uint32Array;
  end: Uint32Array;
  source: Uint8Array;
  owner: Uint32Array;
  strings: string[];
}

export interface NativeCaseJournals {
  /** Every case, in the case index's order; `runner` is the id its runner gave it. */
  cases(): { id: string; file: string; name: string; runner: string; project?: string | null }[];
  /** What Eyes handed the cases that watched, each journal as JSON text; `null` when none did. */
  eyes(): { watched: string[]; journals: { case: string; attempt: number; journal: string }[] } | null;
  /**
   * The case index's bytes over `modules`; `readings` join a reading into its file's record, a land
   * of `0xFFFFFFFF` where the region has no place there; `durations` and
   * `limits` follow `cases()`, `NaN` where the runner reported none;
   * `budgetBytes` bounds the test-by-region relation one slice holds.
   */
  fold(
    modules: NativeFoldModules,
    readings: { id: string; target: string; lands: number[] }[],
    durations: number[],
    limits: number[],
    budgetBytes?: number,
  ): Promise<{ bytes: Buffer; passes: number; crossings: number }>;
}

/** One module's edit between two texts, as git's `-U0` hunks and the selector's reading. */
export interface NativeCaseEdit {
  readonly hunks: readonly { readonly oldStart: number; readonly oldCount: number; readonly newStart: number; readonly newCount: number }[];
  readonly reading?: string;
}

/** What a run knows about the test files it was handed, as the native layering reads it (`native/src/case_layer_napi.rs`). */
export interface NativeCaseRunFiles {
  readonly ran: readonly string[];
  readonly finished: readonly string[];
  /** A held test file is present when it is on disk under this root. */
  readonly presentUnder?: string;
  /** A held test file is present when it is one of these; wins over `presentUnder`. With neither, every one is. */
  readonly presentAmong?: readonly string[];
  readonly sameText?: readonly string[];
  readonly sameBeforeText?: readonly string[];
  readonly base?: Uint8Array;
  readonly before: boolean;
}

export interface NativeCaseLayers {
  readonly merged: Buffer;
  readonly cases: string[];
  readonly last: string[];
  readonly announced: string[];
  readonly before?: Buffer | null;
  /** The file of every module `before` holds, in its order; empty without one. */
  readonly beforeModules: string[];
  readonly unlined: string[];
}

/** One region of a cut, as the addon compares two cuts. */
export interface NativeCaseRegion {
  readonly kind: string;
  readonly name: string;
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
}

/** A module's rows as a cut no case has entered yet. */
export interface NativeCaseCut {
  readonly file: string;
  readonly blocks: NativeJourneyModule['blocks'];
  readonly owners: readonly number[];
}
