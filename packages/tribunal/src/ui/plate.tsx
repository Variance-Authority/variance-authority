import type { CSSProperties, ReactElement } from 'react';

/**
 * The plate: what a layer is drawn at, and what draws it.
 *
 * Its own module because these four answer one question — *how large is this,
 * and against what* — and the rest of [`viewer.tsx`](./viewer.tsx) answers the
 * other one, which is what a reviewer is currently looking at. A mode, a zoom
 * and a focused region are state a person moves; a share of the plate is
 * arithmetic over two numbers the run measured, and the two are read apart.
 *
 * The position they hold together is that a layer is placed by what was measured
 * or is not placed at all. Nothing here invents a dimension: an unmeasured layer
 * is handed back `undefined` and falls to the stylesheet's `width: 100%`, and an
 * unmeasured raster is deferred without a reservation. Either alternative is a
 * difference this surface would have introduced between two pictures whose only
 * job is to differ exactly as much as the build did.
 */

/** A raster's own pixels — never a rendered size, which the zoom decides. */
export type Size = { readonly width: number; readonly height: number };

/** The box that contains both captures, when either of them is known. */
export function union(
  candidate: Size | undefined,
  baseline: Size | undefined,
): Size | undefined {
  if (candidate === undefined) return baseline;
  if (baseline === undefined) return candidate;
  return {
    width: Math.max(candidate.width, baseline.width),
    height: Math.max(candidate.height, baseline.height),
  };
}

/**
 * One layer's share of the plate, as a percentage.
 *
 * A percentage rather than a pixel width so that nothing here has to know the
 * magnification: the plate is sized once and every layer scales with it. Absent
 * when this layer's own size was never recorded, which leaves the stylesheet's
 * `width: 100%` — the old behaviour, and the honest one, since a layer nobody
 * measured cannot be placed against one that was.
 */
export function share(own: Size | undefined, box: Size | undefined): CSSProperties | undefined {
  if (own === undefined || box === undefined || own.width === box.width) return undefined;
  return { width: `${String((own.width / box.width) * 100)}%` };
}

/**
 * One stored raster, fetched when it is about to be looked at.
 *
 * `loading="lazy"`, because a build page is a docket of every subject and a
 * reviewer reads one at a time. A route suite's candidates are full-page: this
 * project's four routes come to nine thousand pixels of height each, and twenty
 * of them decoded at once is tens of thousands of rows of bitmap in one document
 * — enough to stall the renderer before the first row of the table can be read.
 * Nothing above the fold needs any of them.
 *
 * `size` reserves the box before the bytes arrive, and is passed only where the
 * dimensions belong to *this* raster — the candidate. A baseline may have been a
 * different height (that is frequently the change), and a diff mask is not
 * measured at all, so those are deferred without a reservation rather than
 * reserved wrongly. A wrong reservation is worse than none: the page settles at
 * one height and then jumps.
 */
export function Raster({
  src,
  alt,
  size,
  className,
  style,
}: {
  readonly src: string;
  readonly alt: string;
  readonly size?: { readonly width: number; readonly height: number } | undefined;
  readonly className?: string | undefined;
  readonly style?: CSSProperties | undefined;
}): ReactElement {
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      {...(size === undefined ? {} : { width: size.width, height: size.height })}
      {...(className === undefined ? {} : { className })}
      {...(style === undefined ? {} : { style })}
    />
  );
}
