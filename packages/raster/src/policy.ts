import type { ChangeMask } from '@variance-authority/core/attribute';

/**
 * What a comparison is asked for, and what it hands back — without a codec.
 *
 * A policy is a number and a boolean. It decides verdicts, it belongs in the
 * plan's identity, and a caller choosing between `default` and `strict` is making
 * the most consequential configuration decision this project offers. None of that
 * requires the ability to decode a PNG, so none of it lives behind one: a
 * consumer who compares images elsewhere still needs to say which policy the
 * numbers came from, and a plan still needs to fold that policy into its digest.
 *
 * The implementation is `@variance-authority/png`, which is where `pixelmatch`
 * and `pngjs` are installed and the only place they are.
 */

export interface DiffPolicy {
  readonly id: string;
  /** Per-pixel colour distance, 0–1, in `pixelmatch`'s YIQ metric. */
  readonly threshold: number;
  /**
   * `true` counts antialiased pixels. `pixelmatch` defaults to `false`, i.e. it
   * detects and *forgives* antialiasing, which is what a real deployment runs
   * because text edges are otherwise permanently red.
   */
  readonly includeAA: boolean;
}

/**
 * The policy a verdict is decided under: antialiasing forgiven, and a colour
 * change of at most 1% of the largest difference `pixelmatch`'s YIQ metric
 * measures. Black to white is 97% of that.
 *
 * Not `pixelmatch`'s own `0.1`. That forgives a pixel up to a tenth of that
 * largest difference, and tribunal's border token changing from #2f3437 to
 * #3a4043 is under half of that: every border on the page repainted and 183
 * stories reported `unchanged`. Not `0` either. A page reused across subjects
 * repaints a remounted story up to one level per channel away, which is never
 * more than 0.4% of it, and `0` would turn the wobble into findings.
 * ADR-0026 holds the measurements, which were taken on one darwin/arm64
 * machine: another platform's wobble is unmeasured, and a finding there is the
 * measurement.
 */
export const DEFAULT_POLICY: DiffPolicy = { id: 'default', threshold: 0.01, includeAA: false };

/**
 * Any channel difference at all, antialiasing included.
 *
 * Reported alongside the default so "zero pixels changed" can be told apart from
 * "zero pixels changed *after forgiveness*". Quoting only the forgiving policy is
 * the single most common way to lie with a pixel measurement.
 */
export const STRICT_POLICY: DiffPolicy = { id: 'strict', threshold: 0, includeAA: true };

export interface RasterComparison {
  /** Canvas the two images were compared on: the union of their boxes. */
  readonly width: number;
  readonly height: number;
  /** `true` when the two images were not the same size. */
  readonly dimensionsChanged: boolean;
  readonly before: { readonly width: number; readonly height: number };
  readonly after: { readonly width: number; readonly height: number };
  /** Changed pixels under {@link DiffPolicy.id}, for every policy compared. */
  readonly changed: Readonly<Record<string, number>>;
  readonly total: number;
  /** Mask under the policy the comparison was asked to isolate on. */
  readonly mask: ChangeMask;
  /**
   * How the rows of the two images were paired, when they were.
   *
   * Present when the images are the same width and the edit between their rows
   * was small enough to find: then every after row was compared with the before
   * row that shows the same content, `width` and `height` are the after image's,
   * and the mask is in its coordinates. Absent when they were compared position
   * by position on the union box. Empty lists are an alignment that found nothing
   * moved, not a missing one.
   */
  readonly alignment?: RowAlignment;
}

/** Rows `from` up to, and not including, `to`. */
export interface RowSpan {
  readonly from: number;
  readonly to: number;
}

/**
 * Which content of the before image arrived, left or moved in the after image.
 *
 * Removed rows have no after pixel to mark, so the mask cannot show them; they
 * are here, with the after row they left from, or a change that only took
 * something away would read as no change at all.
 */
export interface RowAlignment {
  /** After rows no before row shows, marked in full in the mask. */
  readonly inserted: readonly RowSpan[];
  /** Before rows no after row shows, and the after row they were removed at. */
  readonly removed: readonly (RowSpan & { readonly at: number })[];
  /** After rows paired with a before row at another height, and how far they moved. */
  readonly shifted: readonly (RowSpan & { readonly by: number })[];
}

export interface CompareOptions {
  /** Policies to count. Defaults to both. */
  readonly policies?: readonly DiffPolicy[];
  /** Which policy's mask is returned for isolation. Defaults to {@link DEFAULT_POLICY}. */
  readonly isolateWith?: DiffPolicy;
}
