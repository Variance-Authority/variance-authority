/**
 * What the native scanner's coverage lookups take and answer: rows of a
 * coverage record found by path, and the strings of the rows a selection
 * reports, with every probe of a search decoded on the native side.
 *
 * Declared apart from `native.ts` for the reason `native-journeys.ts` is: the
 * scanner's contract is long, and each family of calls is read on its own.
 * `native/src/coverage_lookup.rs` answers.
 */

/** A test that declares some of the asked files, and the indices of those it declares, in its own order. */
export interface NativeCoverageGoverned {
  readonly test: number;
  readonly files: number[];
}

/** The name and path of each asked block, each an index into `strings`. */
export interface NativeCoverageRegions {
  readonly strings: string[];
  readonly names: Uint32Array;
  readonly paths: Uint32Array;
}

/**
 * One coverage record's lookups, for as long as the record is open. Each run
 * of a column is read through the record's door and decompressed the first
 * time a lookup probes a row inside it, and kept from then on.
 */
export interface NativeCoverageLookup {
  /** Every module row recorded under exactly this path, in row order. */
  modules(path: string): number[];
  /** The test row recorded under exactly this path. */
  test(path: string): number | null | undefined;
  /** The id the dictionary interned this string under. */
  interned(value: string): number | null | undefined;
  /** The path of each of these test rows. */
  testPaths(tests: Uint32Array): string[];
  /** The tests that declare any of `files` as a precondition, in row order. */
  governed(files: string[]): NativeCoverageGoverned[];
  /** What every test declares other than its own file, in code-unit order. */
  shared(): string[];
  regions(blocks: Uint32Array): NativeCoverageRegions;
}

export interface NativeCoverageLookups {
  /** The lookups of a record `length` bytes long, whose bytes `read` hands over one range at a time. */
  openCoverageLookup?(length: number, read: (from: number, to: number) => Uint8Array): NativeCoverageLookup;
}
