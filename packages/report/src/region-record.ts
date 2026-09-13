/**
 * One rectangle of a raster difference, with what the semantic tier made of it.
 *
 * Its own file for the reason {@link VariationRecord} has one: the shapes a
 * report is made of are argued where they belong, and `format.ts` re-exports
 * them so a reader importing the report's shape gets all of them at once.
 */
export interface RegionRecord {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly pixels: number;
  readonly component?: string;
  readonly path?: string;
  /** Landmark phrase, e.g. `main → list item 2 of 3`. */
  readonly where?: string;
  readonly file?: string;
  /**
   * `true` when the semantic tier named this component a root of the change.
   *
   * The field that decides whether a report leads with the edit or with what the
   * edit pushed around. See `rankRegions` — area alone gets this backwards.
   */
  readonly cause: boolean;
  /** `true` when no box contained the region; a wrong scale or origin. */
  readonly unattributed?: boolean;

  /**
   * The shape of this difference, with position and values removed.
   *
   * Printed so that writing a shape-scoped ignore is copying a digest out of the
   * report rather than deriving one. Two regions with the same fingerprint are
   * the same kind of thing happening, wherever on the canvas they landed.
   */
  readonly fingerprint?: string;
}
