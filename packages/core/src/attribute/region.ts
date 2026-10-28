import { intersectionArea, type Rect } from '../format/capture.js';
import { locate } from './locate.js';
import { matchTrees } from '../compare/diff/match.js';
import type { DiffRegion } from './mask.js';
import type { NodePath, SemanticNode, SemanticSnapshot } from '../format/snapshot.js';
import type { SourceLocation } from '../format/provenance.js';

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
   * The line of JSX that produced this node, when the build recorded one.
   *
   * The last hop, and a different answer from the one a component name gets.
   * Resolving `Button` against a source index names where `Button` is
   * *declared*; this names where the element that changed is *written*, which
   * for anything rendered more than once is the only one of the two that
   * distinguishes the instances. Present only under
   * `@variance-authority/jsx-source` or React ≤18 — the name scan is what a
   * repository that has configured nothing still gets.
   */
  readonly source?: SourceLocation;

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

  /**
   * The snapshot of the render the pixels are compared against.
   *
   * Required, and `undefined` is an answer: it says the other render is not
   * known. A changed region is the union of what left and what arrived, so each
   * node is joined against its box in this render and the box of the node the
   * differ's matcher pairs it with in that one. Without it a control replaced
   * by a larger element changes pixels outside either box alone, and the join
   * names the row it sits in.
   *
   * Its boxes are placed by where they were in its own image, whose corner is
   * {@link beforeOrigin}. A shot clipped to the subject starts at its root, so
   * a root the page moved between the two shots moves none of the pixels, and
   * each box that left is shifted by it.
   */
  readonly before: SemanticSnapshot | undefined;

  /**
   * Page-space CSS origin of the before image's top-left corner.
   *
   * Defaults to `before`'s own root rect, as `origin` defaults to this
   * render's. Required when `origin` is stated and `before` is a snapshot: two
   * shots clipped to anything but the root share a corner only by the page's
   * layout, and a corner guessed from the other image gives a plausible report
   * about the wrong components. A full-page pair passes `{x: 0, y: 0}` for both.
   */
  readonly beforeOrigin?: { readonly x: number; readonly y: number };

  /**
   * The rows of this image that have no partner in the before image, as
   * half-open runs of raster rows.
   *
   * Such a row is marked edge to edge, because nothing says where its content
   * begins, so a region inside one is as wide as the image and only the root
   * contains it by area. It is joined by its rows instead: to the tightest box
   * whose rows span it, which is the box that grew. Absent when the rows were
   * compared by position.
   */
  readonly inserted?: readonly { readonly from: number; readonly to: number }[];
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
  if (options.origin !== undefined && options.before !== undefined && options.beforeOrigin === undefined) {
    throw new Error(
      '`origin` is stated and `beforeOrigin` is not: state the corner of the before image too, ' +
        'since two shots share one only when the page did not move between them',
    );
  }
  const origin = options.origin ?? snapshot.root.rect ?? { x: 0, y: 0 };
  // A box that left is placed by where it was in its image, not on the page.
  const was = options.beforeOrigin ?? options.before?.root.rect ?? origin;
  const left = keptBoxes(options.before, snapshot, { x: origin.x - was.x, y: origin.y - was.y });
  const boxed = collectBoxes(snapshot.root).map((node) => {
    const before = left.get(node);
    const rects = before === undefined ? [node.rect!] : [node.rect!, before];
    return { node, rects, area: extent(rects) };
  });
  const containment = options.containment ?? DEFAULT_CONTAINMENT;

  return regions.map((region) => {
    const css: Rect = {
      x: region.x / options.scale + origin.x,
      y: region.y / options.scale + origin.y,
      width: region.width / options.scale,
      height: region.height / options.scale,
    };
    const area = css.width * css.height;
    // Rows the after image added are joined by the rows they span, and only to
    // this render's box: the before side never painted them.
    const added = options.inserted?.some((run) => run.from <= region.y && region.y + region.height <= run.to) ?? false;

    let inside: (typeof boxed)[number] | undefined;
    let overlapping: (typeof boxed)[number] | undefined;

    for (const box of boxed) {
      const shared = covered(css, box.rects);
      if (shared <= 0) continue;

      const nodeArea = box.area;

      // `<=`, not `<`, and the difference is one component name in every report
      // over a design system. A wrapper that shrink-wraps its only child carries
      // a *byte-identical* rect — measured on `cases/storybook-case`, where
      // `Tokens` and `Button` are both `454.34,359 115.33×50` — so neither is
      // tighter than the other and the walk decides. `collectBoxes` is pre-order,
      // so a strict `<` keeps whichever came first, which is always the outer
      // one: the run then names the wrapper nothing edited and sends a reviewer
      // to its file. Ties go to the last box seen, which is the innermost, and is
      // also the one the browser painted on top.
      const contained = added
        ? spans(box.node.rect!, css) && box.node.rect!.width * box.node.rect!.height > 0
        : area > 0 && shared / area >= containment;
      if (contained) {
        if (inside === undefined || nodeArea <= inside.area) inside = box;
      }
      // The same rule for `nearest`. It is orientation rather than attribution,
      // and a hint should point at the same node the join would have picked.
      if (overlapping === undefined || nodeArea <= overlapping.area) {
        overlapping = box;
      }
    }

    if (inside !== undefined) {
      return {
        region,
        path: inside.node.path,
        ...describe(snapshot, inside.node),
        unattributed: false,
      };
    }

    return {
      region,
      unattributed: true,
      ...(overlapping !== undefined
        ? { nearest: { path: overlapping.node.path, ...describe(snapshot, overlapping.node) } }
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
 * div on the todomvc corpus changes 1853 pixels in 5 regions, which attribute
 * geometrically and rank by area as:
 *
 * ```
 *  1055px  Text      <- changed, and reflowed
 *   614px  Stack     <- only reflowed
 *   184px  Toggle    <- the edit
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
): { component?: string; owner?: string; where?: string; source?: SourceLocation } {
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
    ...(node.provenance?.source ? { source: node.provenance.source } : {}),
  };
}

/**
 * The box each node in `after` had in `before`, by the node.
 *
 * Paired by `matchTrees`, the matcher the semantic diff reads, so a region and
 * a delta never disagree about which element a node was. A path is not the key
 * across renders because it is a position, and a sibling inserted ahead
 * renumbers the node. A box with no area paints nothing, so it widens nothing.
 */
function keptBoxes(
  before: SemanticSnapshot | undefined,
  after: SemanticSnapshot,
  shift: { readonly x: number; readonly y: number },
): ReadonlyMap<SemanticNode, Rect> {
  const kept = new Map<SemanticNode, Rect>();
  if (before === undefined) return kept;
  for (const [left, arrived] of matchTrees(before.root, after.root).pairs) {
    const rect = left.rect;
    if (rect !== undefined && rect.width * rect.height > 0) {
      kept.set(arrived, { ...rect, x: rect.x + shift.x, y: rect.y + shift.y });
    }
  }
  return kept;
}

/**
 * How much of `rect` the boxes cover, counting what two of them share once.
 *
 * A node's two boxes are two places, not the rectangle that holds both: a node
 * that moved across a row was never in the space between, and a change there is
 * not its.
 */
function covered(rect: Rect, [first, second]: readonly Rect[]): number {
  const one = intersectionArea(rect, first!);
  if (second === undefined) return one;
  const both = overlap(first!, second);
  return one + intersectionArea(rect, second) - (both === undefined ? 0 : intersectionArea(rect, both));
}

/** Whether `box`'s rows cover every row of `rect`, wherever their columns are. */
function spans(box: Rect, rect: Rect): boolean {
  return box.y <= rect.y && rect.y + rect.height <= box.y + box.height;
}

/** The area the boxes cover together, counting what two of them share once. */
function extent(rects: readonly Rect[]): number {
  const [first, second] = rects;
  if (second === undefined) return first!.width * first!.height;
  const x = Math.min(first!.x, second.x);
  const y = Math.min(first!.y, second.y);
  const width = Math.max(first!.x + first!.width, second.x + second.width) - x;
  const height = Math.max(first!.y + first!.height, second.y + second.height) - y;
  return covered({ x, y, width, height }, rects);
}

function overlap(a: Rect, b: Rect): Rect | undefined {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const width = Math.min(a.x + a.width, b.x + b.width) - x;
  const height = Math.min(a.y + a.height, b.y + b.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : undefined;
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
