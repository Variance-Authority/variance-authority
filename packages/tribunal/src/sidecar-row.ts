import type { Raster } from '@variance-authority/core/format';
import { REFUSAL, RasterStoreError, messageOf, sidecarFrom } from '@variance-authority/raster';

/** Shape of every baseline and cache row as it comes back out of D1. */
export interface SidecarRow {
  readonly identity: string;
  readonly document_digest: string;
  /**
   * Null exactly when {@link SidecarRow.object_key} is: the subject occupies no
   * pixels, so nothing was photographed and there is no object to point at. The
   * three are written together, and {@link parseRow} refuses a row carrying some.
   */
  readonly width: number | null;
  readonly height: number | null;
  readonly missing_fonts: string;
  readonly object_key: string | null;
  readonly accessibility?: string | null;
  /**
   * Baselines only; the render cache stores pixels and stripped these before
   * they ever reached a row. Null is *not recorded*, which is what every
   * baseline written before these columns existed says, and is not `[]`.
   */
  readonly components?: string | null;
  readonly finding_marks?: string | null;
  /**
   * The packed snapshot, stored as it arrived: `Raster.snapshot` is already
   * text, and this side neither unpacks nor reads it. Null is *not recorded*.
   */
  readonly snapshot?: string | null;
}

/**
 * A sidecar row, checked rather than cast.
 *
 * The columns came out of a database this process did not write in this run —
 * one that may have been written by an older version of this package, or by a
 * `put` that raced a schema change. Believed unchecked, a malformed `identity`
 * becomes a digest taken over nothing and a missing `documentDigest` becomes
 * `undefined` compared against a real one: two invented answers where the honest
 * one is that the record cannot be read.
 */
export function parseRow(row: SidecarRow, where: string): Omit<Raster, 'bytes'> {
  let identity: unknown;
  let missingFonts: unknown;
  let accessibility: unknown;
  let components: unknown;
  let findingMarks: unknown;
  try {
    identity = JSON.parse(row.identity) as unknown;
    missingFonts = JSON.parse(row.missing_fonts) as unknown;
    accessibility = row.accessibility == null ? undefined : (JSON.parse(row.accessibility) as unknown);
    // Absent columns and null columns are the same answer here — a baseline
    // that never recorded this — and both leave the field off the sidecar,
    // where `sidecarFrom` reads absence as *unknown* rather than as *none*.
    components = row.components == null ? undefined : (JSON.parse(row.components) as unknown);
    findingMarks = row.finding_marks == null ? undefined : (JSON.parse(row.finding_marks) as unknown);
  } catch (error) {
    throw new RasterStoreError(
      `${where} holds JSON columns that will not parse: ${messageOf(error)}. ${REFUSAL}.`,
      { cause: error },
    );
  }

  // The dimensions and the object key are one fact recorded twice, and a row
  // where they disagree is refused. Dimensions with no object is half a baseline
  // — the case `halfAPair` exists for — and an object with no dimensions is a
  // picture nothing can be scaled against.
  const sized = row.width != null && row.height != null;
  if (sized !== (row.object_key != null)) {
    throw new RasterStoreError(
      `${where} records ${sized ? 'an image with no object behind it' : 'an object it never took'}: ` +
        'the dimensions and the object key are written together, and one without the other is ' +
        `damage rather than a subject with no pixels. ${REFUSAL}.`,
    );
  }

  const sidecar = sidecarFrom({
    identity,
    missingFonts,
    documentDigest: row.document_digest,
    ...(sized ? { width: row.width, height: row.height } : {}),
    ...(accessibility === undefined ? {} : { accessibility }),
    ...(components === undefined ? {} : { components }),
    ...(findingMarks === undefined ? {} : { findingMarks }),
    ...(row.snapshot == null ? {} : { snapshot: row.snapshot }),
  });

  if (sidecar === null) {
    throw new RasterStoreError(
      `${where} is not a raster record: it parsed, but does not carry a document digest and ` +
        `the identity that painted it. ${REFUSAL}.`,
    );
  }
  return sidecar;
}
