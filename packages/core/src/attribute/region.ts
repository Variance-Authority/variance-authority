import type { Rect } from '../format/capture.js';
import { locate } from './locate.js';
import type { DiffRegion } from './mask.js';
import type { NodePath, SemanticNode, SemanticSnapshot } from '../format/snapshot.js';

/**
 * Isolating a pixel difference, and connecting it to the tree.
 *
 * A pixel differ answers one question — *how many pixels moved* — and that number
 * is the reason "looks right, merge" exists. 5482 is not a finding. It cannot be
 * read, it cannot be assigned, and the only available response to it is to open
 * the image and look, which is the expensive act the tool was supposed to replace.
 *
 * Two phases turn it into something else, and they are separate because they fail
 * differently. `mask.ts` is arithmetic on a bitmask — no DOM, no snapshot, no
 * notion of what a component is — and answers *where on the canvas*.
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

  /**
   * Nearest enclosing component, when it is not the one that authored the node.
   *
   * Two namespaces meet here and neither is wrong. `component` is `createdBy` —
   * who wrote the JSX (ADR-0007) — and a component *hash* is named for the
   * enclosure (ADR-0018). They diverge exactly where an element is passed as a
   * prop: `<Card title={<h3>Invoice</h3>} />` gives the `<h3>` `createdBy: Page`
   * and `owners[0]: Card`.
   *
   * Carried so that ranking can match a cause list without guessing which of the
   * two it is written in. Matching one namespace against the other does not
   * fail loudly — it silently finds nothing, and the ordering falls back to area,
   * which is the thing the cause list exists to prevent.
   */
  readonly owner?: string;

  /**
   * The shape of this difference, with its position and values removed.
   *
   * Filled in by whoever held the mask — `attributeRegions` never sets it,
   * because a fingerprint is computed from pixels and this function is given
   * boxes. It exists on this type rather than beside it so that the digest
   * travels with the region a reader is looking at: writing an ignore means
   * copying the fingerprint of the thing that annoyed you, and a digest printed
   * in a different section is a digest nobody matches up.
   *
   * See `fingerprintOfMask` in `core/judge`.
   */
  readonly fingerprint?: string;
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

      // `<=`, not `<`, and the difference is one component name in every report
      // over a design system. A wrapper that shrink-wraps its only child carries
      // a *byte-identical* rect — measured on `cases/storybook-case`, where
      // `Tokens` and `Button` are both `454.34,359 115.33×50` — so neither is
      // tighter than the other and the walk decides. `collectBoxes` is pre-order,
      // so a strict `<` keeps whichever came first, which is always the outer
      // one: the run then names the wrapper nothing edited and sends a reviewer
      // to its file. Ties go to the last box seen, which is the innermost, and is
      // also the one the browser painted on top.
      if (area > 0 && shared / area >= containment) {
        if (inside === undefined || nodeArea <= inside.rect!.width * inside.rect!.height) inside = node;
      }
      // The same rule for `nearest`. It is orientation rather than attribution,
      // and a hint should point at the same node the join would have picked.
      if (overlapping === undefined || nodeArea <= overlapping.rect!.width * overlapping.rect!.height) {
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
      // Either namespace. A cause list is named for enclosures and a region is
      // named for its author, and where those differ a one-sided test finds
      // nothing and silently reverts the ordering to area.
      cause:
        (region.component !== undefined && named.has(region.component)) ||
        (region.owner !== undefined && named.has(region.owner)),
    }))
    .sort((a, b) => Number(b.cause) - Number(a.cause) || b.region.pixels - a.region.pixels);
}

function describe(
  snapshot: SemanticSnapshot,
  node: SemanticNode,
): { component?: string; owner?: string; where?: string } {
  // `createdBy` before `owners[0]`: the component whose JSX produced this element
  // owns its appearance, while the nearest enclosing component merely contains it.
  const owner = node.provenance?.owners[0]?.name;
  const component = node.provenance?.createdBy ?? owner;
  const where = locate(snapshot.root, node.path).where;

  return {
    ...(component !== undefined ? { component } : {}),
    // Only when it says something `component` does not. An `owner` that repeats
    // the author is noise in every report that prints it.
    ...(owner !== undefined && owner !== component ? { owner } : {}),
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
