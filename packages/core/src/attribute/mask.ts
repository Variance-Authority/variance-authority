import type { Rect } from '../format/capture.js';
import type { IgnoreSite, SemanticSnapshot } from '../format/snapshot.js';

/**
 * A change as a bitmask: where on the canvas, and what was excluded from it.
 *
 * Arithmetic, and nothing else. No DOM, no snapshot, no notion of what a
 * component is — which is why it is the half of attribution that can be tested
 * with a hand-written mask and why it is a file of its own. Everything here
 * answers *where on the canvas*; `region.ts` joins those coordinates to a tree
 * and answers *what is there*, and the two fail differently enough that reading
 * one to understand the other was how they came to share 500 lines.
 *
 * The pixel count is what this exists to defeat. "5482 pixels changed" cannot be
 * read, cannot be assigned, and leaves opening the image as the only available
 * response — the expensive act the tool was supposed to replace.
 */

/**
 * Per-pixel changed/unchanged, row-major, one byte per pixel.
 *
 * A mask rather than a diff image: an image is for looking at, and everything
 * downstream of here wants to compute. Producing one is the comparison phase's
 * job and involves PNG decoding; consuming one is pure.
 */
export interface ChangeMask {
  readonly width: number;
  readonly height: number;
  /** `1` where the pixel differs. Length is `width * height`. */
  readonly data: Uint8Array;
  /** Count of set bytes, carried so callers need not rescan. */
  readonly changed: number;
}

export interface DiffRegion extends Rect {
  /** Changed pixels inside the box. Always ≤ `width * height`. */
  readonly pixels: number;
  /** `pixels / (width * height)`. Low means scattered; high means a solid block. */
  readonly density: number;
}

export interface IsolationOptions {
  /**
   * Grid size, in pixels, at which neighbouring changes are considered one place.
   *
   * Not a tuning knob so much as a statement about what a region *is*. At cell 1
   * every antialiased glyph edge is its own region and a paragraph of restyled
   * text produces four hundred of them, which is the same unreadable output as a
   * single number, only longer. At cell 8 a word is one region and a button is
   * one region, which is the granularity a person names when they point at a
   * screen.
   */
  readonly cell?: number;

  /**
   * Cap on regions returned, largest first.
   *
   * Truncation is reported in {@link Isolation.truncated} rather than applied
   * silently. A capped list that does not say it was capped reads as complete
   * coverage, and the reader has no way to know the difference.
   */
  readonly limit?: number;
}

export interface Isolation {
  readonly regions: readonly DiffRegion[];
  /** Regions found but not returned, because of `limit`. `0` in the normal case. */
  readonly truncated: number;
  /** Changed pixels in the truncated tail. Nothing is lost silently. */
  readonly truncatedPixels: number;
}

const DEFAULT_CELL = 8;
const DEFAULT_LIMIT = 32;

/**
 * Cluster a change mask into regions.
 *
 * Connected components are computed on a coarse grid rather than on the pixels
 * themselves. That is a performance decision and a semantic one at once: the
 * coarse pass is one linear sweep instead of a merge over thousands of glyph-edge
 * fragments, and it produces the grouping a reader would have produced by eye.
 * Bounding boxes are then tightened back onto the actual changed pixels, so a
 * region's coordinates are exact even though its *membership* was decided coarsely.
 */
export function isolateRegions(mask: ChangeMask, options: IsolationOptions = {}): Isolation {
  const cell = Math.max(1, Math.floor(options.cell ?? DEFAULT_CELL));
  const limit = options.limit ?? DEFAULT_LIMIT;

  const columns = Math.ceil(mask.width / cell);
  const rows = Math.ceil(mask.height / cell);
  const occupied = new Uint8Array(columns * rows);

  for (let y = 0; y < mask.height; y += 1) {
    const rowOffset = y * mask.width;
    const gridRow = ((y / cell) | 0) * columns;
    for (let x = 0; x < mask.width; x += 1) {
      if (mask.data[rowOffset + x] !== 0) occupied[gridRow + ((x / cell) | 0)] = 1;
    }
  }

  const seen = new Uint8Array(occupied.length);
  const found: DiffRegion[] = [];

  for (let index = 0; index < occupied.length; index += 1) {
    if (occupied[index] === 0 || seen[index] !== 0) continue;

    // Explicit stack. A full-page change is a single component covering every
    // cell, and recursion at that depth is a stack overflow rather than a slow path.
    const stack = [index];
    seen[index] = 1;
    const cells: number[] = [];

    while (stack.length > 0) {
      const current = stack.pop()!;
      cells.push(current);

      const cx = current % columns;
      const cy = (current / columns) | 0;

      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= columns || ny >= rows) continue;

          const neighbour = ny * columns + nx;
          if (occupied[neighbour] === 0 || seen[neighbour] !== 0) continue;

          seen[neighbour] = 1;
          stack.push(neighbour);
        }
      }
    }

    found.push(tighten(mask, cells, cell, columns));
  }

  found.sort((a, b) => b.pixels - a.pixels || a.y - b.y || a.x - b.x);

  const kept = found.slice(0, limit);
  const dropped = found.slice(limit);

  return {
    regions: kept,
    truncated: dropped.length,
    truncatedPixels: dropped.reduce((sum, region) => sum + region.pixels, 0),
  };
}

export interface Subtraction {
  /** The mask with the excluded boxes cleared. Never the same object. */
  readonly mask: ChangeMask;

  /** Changed pixels that fell inside an excluded box. */
  readonly ignored: number;

  /**
   * Pixels each input box cleared, in the order the boxes were given.
   *
   * Positional rather than keyed, because this file knows nothing about ignore
   * rules and should not start: a box is geometry. The caller that supplied the
   * boxes knows which rule each came from and can attribute the counts, which is
   * what a per-rule register is assembled from.
   *
   * Two boxes overlapping share their pixels on a first-come basis, so these sum
   * to {@link Subtraction.ignored} exactly and never double-count.
   */
  readonly cleared: readonly number[];

  /**
   * Boxes that covered no changed pixel at all.
   *
   * The raster half of the dead-ignore register. A mask drawn around a carousel
   * that has since been removed covers nothing, and an operator who cannot see
   * that keeps a hole in the suite because deleting it feels risky.
   *
   * Judged against the *original* mask, not against what earlier boxes left. Two
   * rules covering one element is ordinary — a selector and a marker attribute
   * reaching the same node — and clearing is first-come, so the second box would
   * otherwise clear zero and be reported as covering nothing at all. That reads
   * as "delete this rule" about a rule that is working.
   */
  readonly inert: readonly Rect[];
}

/**
 * Clear excluded boxes out of a change mask, and say what that cost.
 *
 * The raster half of an ignore (spec 0024). The semantic half drops deltas under
 * a subtree; this drops the pixels the same subtree occupied, so the two tiers
 * cannot disagree about what the subject is — a region excluded semantically and
 * still compared on pixels arrives as `unexplained`, the highest severity in the
 * system, for something the operator already said was not the subject.
 *
 * Subtracting *before* isolation rather than filtering regions afterwards, which
 * looks equivalent and is not: a region that straddles the boundary would
 * otherwise be dropped whole or kept whole, and both answers are wrong. Clearing
 * pixels lets the part outside the box cluster on its own and be reported.
 *
 * The count is returned rather than folded away. `changed` on the result is what
 * the run compares against zero; `ignored` is what it owes the reader, because a
 * comparison that discarded four thousand pixels and reported "no difference" is
 * the failure this whole mechanism is written around.
 */
export function subtractRegions(mask: ChangeMask, boxes: readonly Rect[]): Subtraction {
  if (boxes.length === 0) return { mask, ignored: 0, cleared: [], inert: [] };

  const data = Uint8Array.from(mask.data);
  const cleared: number[] = [];
  const inert: Rect[] = [];
  let ignored = 0;

  for (const box of boxes) {
    // Rounded outward. A box is a CSS rectangle and a mask is a pixel grid; the
    // half-pixel at the edge belongs to the thing that was excluded, because the
    // alternative is a one-pixel rim of permanent residue around every ignore.
    const startX = Math.max(0, Math.floor(box.x));
    const startY = Math.max(0, Math.floor(box.y));
    const endX = Math.min(mask.width, Math.ceil(box.x + box.width));
    const endY = Math.min(mask.height, Math.ceil(box.y + box.height));

    let inside = 0;
    for (let y = startY; y < endY; y += 1) {
      const rowOffset = y * mask.width;
      for (let x = startX; x < endX; x += 1) {
        const index = rowOffset + x;
        if (data[index] === 0) continue;
        data[index] = 0;
        inside += 1;
      }
    }

    ignored += inside;
    cleared.push(inside);
    // Against the untouched mask. `inside` counts what *this* box cleared, which
    // is zero for the second of two overlapping boxes however much it covers.
    if (!coversAnyChange(mask, startX, startY, endX, endY)) inert.push(box);
  }

  return {
    mask: { width: mask.width, height: mask.height, data, changed: mask.changed - ignored },
    ignored,
    cleared,
    inert,
  };
}

/** Whether the original mask had any changed pixel in this box. */
function coversAnyChange(
  mask: ChangeMask,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): boolean {
  for (let y = startY; y < endY; y += 1) {
    const rowOffset = y * mask.width;
    for (let x = startX; x < endX; x += 1) {
      if (mask.data[rowOffset + x] !== 0) return true;
    }
  }
  return false;
}

/** Exact extent and count of the changed pixels inside one component's cells. */
function tighten(mask: ChangeMask, cells: readonly number[], cell: number, columns: number): DiffRegion {
  let minX = mask.width;
  let minY = mask.height;
  let maxX = -1;
  let maxY = -1;
  let pixels = 0;

  for (const index of cells) {
    const startX = (index % columns) * cell;
    const startY = ((index / columns) | 0) * cell;
    const endX = Math.min(startX + cell, mask.width);
    const endY = Math.min(startY + cell, mask.height);

    for (let y = startY; y < endY; y += 1) {
      const rowOffset = y * mask.width;
      for (let x = startX; x < endX; x += 1) {
        if (mask.data[rowOffset + x] === 0) continue;
        pixels += 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const width = maxX - minX + 1;
  const height = maxY - minY + 1;

  return { x: minX, y: minY, width, height, pixels, density: pixels / (width * height) };
}


/**
 * Excluded subtrees as device-pixel boxes on the raster's own canvas.
 *
 * The conversion that lets one declaration serve both tiers (spec 0024). A site
 * is recorded in CSS pixels in page space, because that is what a document knows;
 * a mask is device pixels in raster space, because that is what a screenshot is.
 * Getting the transform wrong is not a small error — at the wrong scale every box
 * lands in the top-left quadrant and silences whatever happens to be there — so
 * it is inverted from exactly the expression `attributeRegions` uses in the other
 * direction, in one place, rather than re-derived per caller.
 *
 * Sites with no `rect` are dropped: a profile with no layout engine observed no
 * box, and a box that was never observed must never be inferred. The semantic
 * half of the same rule still applies on that profile, which is the correct
 * asymmetry — that profile decides no pixels either.
 */
export function excludedBoxes(
  snapshot: SemanticSnapshot,
  options: { readonly scale: number; readonly origin?: { readonly x: number; readonly y: number } },
): readonly ExcludedBox[] {
  const sites: readonly IgnoreSite[] = snapshot.ignoreSites ?? [];
  if (sites.length === 0) return [];

  const origin = options.origin ?? snapshot.root.rect ?? { x: 0, y: 0 };

  return sites
    .filter((site): site is IgnoreSite & { rect: Rect } => site.rect !== undefined)
    .map((site) => ({
      rule: site.rule,
      x: (site.rect.x - origin.x) * options.scale,
      y: (site.rect.y - origin.y) * options.scale,
      width: site.rect.width * options.scale,
      height: site.rect.height * options.scale,
    }));
}

/** A box, carrying the rule that excluded it so absorption can be attributed. */
export interface ExcludedBox extends Rect {
  readonly rule: string;
}
