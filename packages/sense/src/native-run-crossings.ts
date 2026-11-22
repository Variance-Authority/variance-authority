/**
 * A run's journals folded into the record's crossings, as the addon's
 * `run_crossings_napi.rs` answers it: the journals' bytes in, columns out.
 */

/** A journal a page handed over, as `ReadJournal` holds it. */
export interface NativeCarriedJournal {
  readonly testFile: string;
  readonly modules: ReadonlyArray<{ readonly id: string; readonly hits: readonly number[]; readonly shared: readonly number[]; readonly loaded: readonly number[] }>;
}

/** Where a read module's ordinals land in its file's record; `0xFFFF_FFFF`, nowhere. */
export interface NativeRunReading {
  readonly id: string;
  readonly target: string;
  readonly lands: readonly number[];
}

/** The fold, column by column: `native/src/run_crossings.rs` says what each holds. */
export interface NativeRunCrossings {
  /** Each test file that left a journal, by its project path, in code-unit order. */
  readonly tests: string[];
  /** Each module a placed row named, by its id after any reading. */
  readonly ids: string[];
  /** Per module: its count of crossed ordinals, then per ordinal, rising, the ordinal, its count of tests and the tests, rising. */
  readonly hits: Uint32Array;
  /** The same for the ordinals entered before the file's first test. */
  readonly loaded: Uint32Array;
  /** Per journal, frames then pages: its test, its count of entered modules, then the modules, rising. */
  readonly journals: Uint32Array;
  /** Per journal, when its file's collection ended; `0`, unmarked. */
  readonly collected: Float64Array;
  /** The journals that named a module the run could not place, rising. */
  readonly unplaced: Uint32Array;
}

/** A fold's crossings as a coverage write reads them: `modules` is the id of each module the write's rows hold, in their order. */
export type NativeRunCrossed = Pick<NativeRunCrossings, 'tests' | 'ids' | 'hits' | 'loaded'> & { readonly modules: string[] };

export interface NativeRunCrossingsFold {
  /** Every module id the journals name, each once, in the order first named. */
  runModuleIds?(journals: Buffer[], pages: NativeCarriedJournal[]): string[];
  /** The run's journals folded under the checkout at `root`; `placed`, when given, is every module the run could place. */
  runCrossings?(journals: Buffer[], pages: NativeCarriedJournal[], root: string, readings: NativeRunReading[], placed: string[] | null): NativeRunCrossings;
}
