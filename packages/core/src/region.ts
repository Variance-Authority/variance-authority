import type { Rect } from './capture.js';
import { locate } from './locate.js';
import type { NodePath, SemanticNode, SemanticSnapshot } from './snapshot.js';

/**
 * Isolating a pixel difference, and connecting it to the tree.
 *
 * A pixel differ answers one question — *how many pixels moved* — and that number
 * is the reason "looks right, merge" exists. 5482 is not a finding. It cannot be
 * read, it cannot be assigned, and the only available response to it is to open
 * the image and look, which is the expensive act the tool was supposed to replace.
 *
 * Two phases turn it into something else, and they are separate because they fail
 * differently. {@link isolateRegions} is arithmetic on a bitmask — no DOM, no
 * snapshot, no notion of what a component is — and answers *where on the canvas*.
 * {@link attributeRegions} joins those coordinates to the box tree and answers
 * *what is there*. The first can be tested with a hand-written mask; the second
 * with a hand-written snapshot; neither needs a browser, which is what makes the
 * pipeline testable at all.
 *
 * The join is geometric and therefore the weakest link in the chain, so it is
 * explicit about failing: a region no box contains is reported `unattributed`.
 * Painting escapes its box routinely — shadows, outlines, overflowing glyphs — and
 * a system that resolved those by picking the nearest node would produce confident
 * attributions of exactly the kind an agent then acts on.
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

export interface AttributedRegion {
  readonly region: DiffRegion;

  /**
   * Tightest node whose border box contains the region, when one does.
   *
   * Tightest rather than topmost: a change inside a button is also inside the
   * card and inside `<main>`, and only the innermost answer is actionable.
   */
  readonly path?: NodePath;
  readonly component?: string;
  /** Landmark phrase from {@link locate}, so a region has a name, not an address. */
  readonly where?: string;

  /**
   * `true` when no box contains the region at all.
   *
   * Rarer than it first looks, and that is worth being precise about. A screenshot
   * clipped to the subject means the root's own box contains every pixel in it, so
   * a region always lands *somewhere* — paint that escapes a button still falls
   * inside the card, and attributing it to the card is correct rather than a
   * consolation prize.
   *
   * What this flag actually catches is a region that fell outside the tree
   * entirely, and the overwhelmingly likely cause is that `scale` or `origin` was
   * wrong. That failure is worth a loud signal precisely because it does not look
   * like one: at the wrong scale every region lands in the top-left quadrant and
   * the report comes out complete, plausible, and about the wrong components.
   */
  readonly unattributed: boolean;

  /**
   * Tightest node the region *overlaps*, present only when unattributed.
   *
   * Offered as orientation, never as attribution — hence the separate field. It
   * answers "what is this near", which is a different claim from "this is what
   * changed", and keeping them in one field is how the second gets asserted with
   * the confidence of the first.
   */
  readonly nearest?: { readonly path: NodePath; readonly component?: string; readonly where?: string };
}

export interface AttributionOptions {
  /**
   * Device pixels per CSS pixel in the raster.
   *
   * Required, with no default. A 2x screenshot silently attributed at 1x lands
   * every region in the top-left quadrant of the page and attributes each of them
   * to the wrong node — a failure that produces a full, plausible, entirely wrong
   * report. Making the caller state it turns that into a decision someone made.
   */
  readonly scale: number;

  /**
   * Page-space CSS origin of the raster's top-left corner.
   *
   * Defaults to the subject root's own rect, which is right when the screenshot
   * was clipped to the subject — the normal case. A full-page shot passes `{x: 0,
   * y: 0}`.
   */
  readonly origin?: { readonly x: number; readonly y: number };

  /**
   * Fraction of a region's area that must fall inside a box to count as inside.
   *
   * Below 1 by default because a region's bounding box is inflated by
   * antialiasing at its edges, so exact containment would reject the correct node
   * on a text change. This is the one genuinely fuzzy number in the join and it
   * is named rather than buried.
   */
  readonly containment?: number;
}

const DEFAULT_CONTAINMENT = 0.9;

/**
 * Join isolated regions to the nodes that occupy them.
 *
 * Requires a snapshot carrying `rect`, i.e. a profile with layout (ADR-0002).
 * Under a profile without one every region comes back unattributed, which is the
 * correct answer — a rect that was never observed must never be inferred.
 */
export function attributeRegions(
  regions: readonly DiffRegion[],
  snapshot: SemanticSnapshot,
  options: AttributionOptions,
): readonly AttributedRegion[] {
  const boxed = collectBoxes(snapshot.root);
  const origin = options.origin ?? snapshot.root.rect ?? { x: 0, y: 0 };
  const containment = options.containment ?? DEFAULT_CONTAINMENT;

  return regions.map((region) => {
    const css: Rect = {
      x: region.x / options.scale + origin.x,
      y: region.y / options.scale + origin.y,
      width: region.width / options.scale,
      height: region.height / options.scale,
    };
    const area = css.width * css.height;

    let inside: SemanticNode | undefined;
    let overlapping: SemanticNode | undefined;

    for (const node of boxed) {
      const rect = node.rect!;
      const shared = intersectionArea(css, rect);
      if (shared <= 0) continue;

      const nodeArea = rect.width * rect.height;

      if (area > 0 && shared / area >= containment) {
        if (inside === undefined || nodeArea < inside.rect!.width * inside.rect!.height) inside = node;
      }
      if (overlapping === undefined || nodeArea < overlapping.rect!.width * overlapping.rect!.height) {
        overlapping = node;
      }
    }

    if (inside !== undefined) {
      return {
        region,
        path: inside.path,
        ...describe(snapshot, inside),
        unattributed: false,
      };
    }

    return {
      region,
      unattributed: true,
      ...(overlapping !== undefined
        ? { nearest: { path: overlapping.path, ...describe(snapshot, overlapping) } }
        : {}),
    };
  });
}

export interface RankedRegion extends AttributedRegion {
  /**
   * `true` when the semantic tier named this region's component as a *root* of
   * the change, rather than as something the change happened to move.
   */
  readonly cause: boolean;
}

/**
 * Rank attributed regions by cause, falling back to area.
 *
 * This function exists because of a measurement, and the measurement is the most
 * useful thing the raster tier has produced. Replacing a checkbox with a styled
 * div on the todomvc corpus changes 1530 pixels in 5 regions, which attribute
 * geometrically and rank by area as:
 *
 * ```
 *   933px  Text      <- changed, and reflowed
 *   511px  Stack     <- only reflowed
 *    86px  Toggle    <- the edit
 * ```
 *
 * Every one of those attributions is correct. The pixels really are inside those
 * nodes. The *ordering* is still wrong, because **area measures displacement,
 * not cause** — an edit that reflows its surroundings moves far more of them than
 * of itself, so `Stack`, which nothing edited, outranks `Toggle`, which is the
 * edit. That is the same defect the differ had when a list reorder blamed the
 * element that moved rather than the code that moved it.
 *
 * Geometry cannot fix this; it has no access to why. The semantic tier does — it
 * has provenance and props digests — so the raster tier stops claiming to rank
 * and takes the ordering from the tier that can. On the case above that promotes
 * `Toggle` above `Stack` while leaving both attributions untouched.
 *
 * Two limits, stated rather than smoothed over. The semantic tier may name more
 * than one cause and here it names two, `Toggle` and `Text`, both real — this
 * does not collapse them, because picking one would be inventing a fact. And
 * with no causes supplied the order falls back to area, which is honest and is
 * not good: pixels alone rank the displaced above the displacer, and nothing
 * inside this file can change that.
 */
export function rankRegions(
  regions: readonly AttributedRegion[],
  causes: readonly string[] = [],
): readonly RankedRegion[] {
  const named = new Set(causes);

  return regions
    .map((region) => ({
      ...region,
      cause: region.component !== undefined && named.has(region.component),
    }))
    .sort((a, b) => Number(b.cause) - Number(a.cause) || b.region.pixels - a.region.pixels);
}

function describe(
  snapshot: SemanticSnapshot,
  node: SemanticNode,
): { component?: string; where?: string } {
  // `createdBy` before `owners[0]`: the component whose JSX produced this element
  // owns its appearance, while the nearest enclosing component merely contains it.
  const component = node.provenance?.createdBy ?? node.provenance?.owners[0]?.name;
  const where = locate(snapshot.root, node.path).where;

  return {
    ...(component !== undefined ? { component } : {}),
    ...(where !== '' ? { where } : {}),
  };
}

/** Every node carrying a rect, in document order. Zero-area boxes are skipped. */
function collectBoxes(root: SemanticNode): readonly SemanticNode[] {
  const out: SemanticNode[] = [];

  const walk = (node: SemanticNode): void => {
    if (node.rect !== undefined && node.rect.width > 0 && node.rect.height > 0) out.push(node);
    for (const child of node.children) walk(child);
  };
  walk(root);

  return out;
}

function intersectionArea(a: Rect, b: Rect): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}
