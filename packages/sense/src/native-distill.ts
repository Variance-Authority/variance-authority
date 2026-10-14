/**
 * What the native scanner's distillation calls take and answer: records read
 * once, then a scope of their test files or one test file, as columns whose ids
 * index `names`. `native/src/distill_read.rs` reads the coverage rows,
 * `distill_cases.rs` the case index and what a charge asks of it,
 * `distill_own.rs` owns and `distill_gather.rs` gathers.
 */
import type { NativeJourneyGraph } from './native-journey.js';

/** The file graph, and the `EDGE_KINDS` indices a distillation reads. */
export interface NativeDistillGraph {
  readonly graph: NativeJourneyGraph;
  /** Imports, re-exports and assets: what a runtime evaluates on load. */
  readonly loading: readonly number[];
  /** A literal `import()`. */
  readonly lazy: readonly number[];
  readonly reexports: number;
}

/** Each test file read, in reading order. `withheld`: 0 read, 1 no cases, 2 an incomplete row, 3 a case that did not settle. */
export interface NativeDistillReadings {
  readonly file: Uint32Array;
  readonly record: Uint32Array;
  readonly cases: Uint32Array;
  readonly withheld: Uint8Array;
  readonly unsettled: Uint32Array;
  readonly loaded: Uint32Array;
  readonly loadedLines: Float64Array;
  readonly unentered: Uint32Array;
  readonly unenteredLines: Float64Array;
}

/** A cause's kind: 0 none (no graph), 1 an import, 2 shared, 3 unseen. */
export interface NativeDistillScope {
  readonly names: string[];
  readonly readings: NativeDistillReadings;
  readonly loads: number;
  readonly lines: number;
  /** Per spill, heaviest first. */
  readonly kind: Uint8Array;
  readonly importer: Uint32Array;
  readonly imported: Uint32Array;
  readonly lazy: Uint8Array;
  readonly spillLines: Float64Array;
  readonly moduleOffset: Uint32Array;
  readonly modules: Uint32Array;
  readonly fileOffset: Uint32Array;
  readonly files: Uint32Array;
}

/** One test file, its modules fewer than all of its cases entered, in the order it lists them. */
export interface NativeDistillFile {
  /** Whether the records' coverage rows hold the file. */
  readonly held: boolean;
  /** The record that holds it, by its place among the records. */
  readonly record: number;
  readonly names: string[];
  readonly cases: number;
  readonly loaded: number;
  readonly lines: number;
  readonly withheld: number;
  readonly unsettled: number;
  readonly module: Uint32Array;
  readonly moduleLines: Float64Array;
  readonly hasLines: Uint8Array;
  readonly entered: Uint32Array;
  readonly kind: Uint8Array;
  readonly importer: Uint32Array;
  /** The imported file of an import, the file a shared module's paths part at. */
  readonly imported: Uint32Array;
  readonly lazy: Uint8Array;
  /** How many test files load an import's importer. */
  readonly loading: Uint32Array;
  /** The files the test file loads, as the graph lists them: its subject. Empty without a graph. */
  readonly subjects: Uint32Array;
}

/** One region of an importer, read against one test file's cases. */
export interface NativeDistillRegion {
  readonly kind: string;
  readonly name: string;
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly source: boolean;
  /** A case of the test file called it. */
  readonly ran: boolean;
  /** The test files whose cases called it, as ids that only compare with each other. */
  readonly called: Uint32Array;
  /** Some case ran it while its module loaded; the case index names no case for that. */
  readonly loaded: boolean;
}

export interface NativeDistillRecords {
  scope(within: string | undefined, graph: NativeDistillGraph | undefined): NativeDistillScope;
  file(file: string, graph: NativeDistillGraph | undefined): NativeDistillFile;
  /** The record that holds `file`, by its place among the records; null when none does. */
  holder(file: string): number | null;
  regions(file: string, importer: string): NativeDistillRegion[];
}

/** One group of a file's unentered modules under its cause; `kind` as a scope's, and both names empty for the shared and the unseen. */
export interface NativeDistillCause {
  readonly kind: number;
  readonly importer: string;
  readonly imported: string;
  readonly lazy: boolean;
  readonly lines: number;
}

export interface NativeDistill {
  /** Coverage records that carry their case index, read once. */
  readDistillRecords?(records: Buffer[]): NativeDistillRecords;
  /** The places of `causes` in the order a scope's spills are read in: `distill_rank.rs`. */
  rankDistillCauses?(causes: NativeDistillCause[]): number[];
}
