import type { SemanticSnapshot } from './snapshot.js';

/**
 * A `SemanticSnapshot` as JSON, gzipped and in base64, after a header that
 * names its format version.
 *
 * Text, so that it survives every hop a raster makes, as `Raster.bytes` does.
 * `packSnapshot` and `unpackSnapshot` in `@variance-authority/observe` are the
 * two ends; between them only {@link keepsSnapshot} reads it, and only its
 * header.
 */
export type PackedSnapshot = string;

/**
 * The format version this code reads, typed from `SemanticSnapshot`, so that it
 * stops compiling when the type moves. The header and `isSemanticSnapshot` both
 * read it; `@variance-authority/core/format` does not export it.
 */
export const FORMAT_VERSION: SemanticSnapshot['formatVersion'] = 1;

/** What a packed snapshot of the format this code reads opens with: its version, outside the gzip. */
export const PACKED_SNAPSHOT_HEADER = `v${FORMAT_VERSION}:`;

/**
 * Whether a raster kept a snapshot this code can read.
 *
 * Read off the header, without unpacking, so that every store gives the same
 * answer, tribunal's inside a Worker with no `node:zlib` too. A snapshot of
 * another format is one this code cannot read, and a baseline that keeps only
 * that keeps none: `settle` renders it, for an accepting run to record one.
 *
 * The header cannot vouch for what follows it. Text damaged after the header
 * is counted as kept here and reads as not recorded where it is unpacked.
 */
export function keepsSnapshot(packed: PackedSnapshot | undefined): boolean {
  return packed !== undefined && packed.startsWith(PACKED_SNAPSHOT_HEADER);
}
