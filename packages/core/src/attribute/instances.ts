import { digestValue } from '../format/hash.js';
import type { Digest } from '../format/hash.js';
import type { NodePath, SemanticNode, SemanticSnapshot } from '../format/snapshot.js';
import { ID_REFERENCE_ATTRIBUTES, ID_REFERENCE_LIST_ATTRIBUTES } from '../rules/ruleset.js';
import {
  boundaries,
  holds,
  shapeOf,
  UNATTRIBUTED,
  type Boundary,
  type Rename,
} from './boundary.js';

/**
 * One digest per component *boundary*, comparable across subjects.
 *
 * `hashComponents` folds every boundary with the same name into one row, which
 * is the right unit for a history — it is the unit an edit moves — and the wrong
 * unit for the question a suite of examples actually poses:
 *
 * > A visual-regression example is a component built from components. The
 * > example *is* a component, at a boundary; the same component appears again,
 * > with the same or different props, inside larger examples. Connecting those
 * > is connecting the dots.
 *
 * Under the aggregate that connection is unmakeable. `Button` in a one-button
 * story digests a list of one shape; `Button` in a page holding three digests a
 * list of three; the two can never be equal, and the fact that one of the three
 * is byte-identical to the story is not recoverable from either digest.
 *
 * So this is the same walk and the same shapes, digested per boundary instead of
 * per name. It is additive: `hashComponents` is untouched and still produces the
 * bytes a sidecar already holds.
 *
 * ## Two things had to change for a digest to cross a subject boundary
 *
 * **Aliases are subject-ordinal.** The normalizer replaces every id with `#a0`,
 * `#a1`, … in document order *across the whole subject* (ADR-0003). That is
 * exactly right for a subject and fatal across two: the same field rendered in a
 * story and on a page gets `#a0` in one and `#a7` in the other, so its structure
 * digests differ and the dots stay unconnected — for a reason that is an
 * artefact of where else the component happened to be mounted. This re-aliases
 * to `#b0`, `#b1`, … in the boundary's own document order, which is the same
 * argument `shapeOf` already makes about paths: an address that shifts when
 * something unrelated moves must not reach a hash.
 *
 * The association survives, which is the property that made aliasing worth doing
 * in the first place. A `for` that points at an input inside the boundary keeps
 * pointing at it. A reference that escapes the boundary keeps its own slot and
 * points at nothing in particular — from inside, one foreign target is
 * indistinguishable from another, and pretending otherwise would report a
 * difference the component cannot see.
 *
 * **Geometry is left out of the joining digest.** A rect is absolute page
 * coordinates, so two identical renderings in two subjects disagree on it
 * always. `rendering` is the four content digests; the geometry digest is
 * carried beside it, where a caller comparing two instances *within* one subject
 * can still read it.
 */

/** One component boundary, hashed. */
export interface ComponentInstance {
  readonly component: string;

  /**
   * Where it sits in this subject. Never hashed — see `shapeOf`.
   *
   * Carried so a finding can be pointed at, which is the whole reason a
   * per-instance record is worth having: "the third `Chip`" is a sentence a
   * reviewer can act on and `instances: 3` is not.
   */
  readonly path: NodePath;

  /** Boundaries between this one and the subject root. The root is `0`. */
  readonly depth: number;

  /** The enclosing boundary's component. Absent on the subject root. */
  readonly within?: string;

  /**
   * Who placed this boundary's element, when it differs from `within`.
   *
   * `within` says which component this one *sits inside* and `createdBy` says
   * which component *wrote the element*, and the two diverge wherever a
   * component is passed as a prop and rendered somewhere else (ADR-0007). That
   * divergence is a fact about composition, so it is kept rather than resolved.
   */
  readonly createdBy?: string;

  /**
   * Digest of the props this boundary received, from `OwnerFrame.propsDigest`.
   *
   * Absent when the collector supplied no provenance for the boundary root —
   * absent, never a digest of nothing, because "rendered with unknown inputs"
   * and "rendered with no inputs" are different claims and only one of them
   * licenses a join.
   *
   * It is one-way. Two instances can be shown to have received different props;
   * *which* prop differed is not recoverable, and nothing here pretends it is.
   */
  readonly props?: Digest;

  /**
   * The four content digests, together. The join key.
   *
   * Two instances with the same `rendering` rendered the same thing, wherever
   * they were and whatever else was on the page with them.
   */
  readonly rendering: Digest;

  readonly structure: Digest;
  readonly semantics: Digest;
  readonly text: Digest;
  readonly style: Digest;
  /** Absent under a profile without layout — absent, never empty (ADR-0002). */
  readonly geometry?: Digest;

  /** Child boundaries, in document order. The edges of the component graph. */
  readonly renders: readonly string[];

  /** Nodes this boundary owns, counting its own root. */
  readonly nodes: number;

  /**
   * Custom properties this boundary's own nodes resolved through, sorted.
   *
   * The join between the token axis and the component axis. A run that reports
   * `--va-space-3` moved can now say which components read it, rather than
   * leaving a reader to guess from a colour.
   */
  readonly tokens: readonly string[];
}

/**
 * Every component boundary in a subject, in document order.
 *
 * Document order, not name order, because unlike `hashComponents` this list is
 * not a set of rows keyed by name — it is a walk, and its order is the only
 * thing that makes "the third `Chip`" mean anything.
 */
export function componentInstances(snapshot: SemanticSnapshot): readonly ComponentInstance[] {
  const layout = snapshot.profile.layout;

  return boundaries(snapshot.root).map((boundary) => {
    const shape = shapeOf(boundary, layout, localAliases(boundary));

    const structure = digestValue(shape.structure);
    const semantics = digestValue(shape.semantics);
    const text = digestValue(shape.text);
    const style = digestValue(shape.style);

    return {
      component: boundary.component,
      path: boundary.node.path,
      depth: boundary.depth,
      ...(boundary.within === undefined ? {} : { within: boundary.within }),
      ...(boundary.placedBy === undefined ? {} : { createdBy: boundary.placedBy }),
      ...(boundary.props === undefined ? {} : { props: boundary.props }),
      rendering: digestValue([structure, semantics, text, style]),
      structure,
      semantics,
      text,
      style,
      ...(layout ? { geometry: digestValue(shape.geometry) } : {}),
      renders: shape.renders,
      nodes: shape.nodes,
      tokens: shape.tokens,
    };
  });
}

/**
 * Whether an instance is worth joining on at all.
 *
 * `(unattributed)` is one bucket per subject collecting every node whose
 * provenance chain broke, anywhere. Two subjects' buckets hold unrelated parts
 * of two pages, so an equality between them means nothing and an inequality
 * means less — it is the only name in the vocabulary that is not a component.
 */
export function attributed(instance: ComponentInstance): boolean {
  return instance.component !== UNATTRIBUTED;
}

const REFERENCE = new Set(ID_REFERENCE_ATTRIBUTES);
const REFERENCE_LIST = new Set(ID_REFERENCE_LIST_ATTRIBUTES);
const ALIAS = /^#(?:a\d+|extern:.*)$/;

/**
 * A boundary-local alias space, assigned in the boundary's own document order.
 *
 * Built in a pass of its own, ahead of hashing, for the reason `buildAliasMap`
 * takes two: a reference may precede its definition, and an alias whose slot
 * depended on which side was seen first would differ between two identical
 * renderings that happened to be reached in a different order. Here the walk
 * order is fixed, so one pass over the boundary's own nodes in document order —
 * definition or reference, whichever is met first — is deterministic and enough.
 *
 * Stops at nested boundaries, exactly as `shapeOf` does. A child component's
 * internal ids are its own; folding them into the parent's alias space would
 * make the parent's structure digest move when the child renumbered internally,
 * which is the ancestor-moves-on-every-leaf-edit failure the boundary rule
 * exists to prevent.
 */
function localAliases(boundary: Boundary): Rename {
  const local = new Map<string, string>();

  const take = (value: string): void => {
    if (!ALIAS.test(value) || local.has(value)) return;
    local.set(value, `#b${local.size}`);
  };

  const walk = (node: SemanticNode): void => {
    if (node.alias !== undefined) take(node.alias);
    for (const [name, value] of Object.entries(node.attributes)) {
      if (REFERENCE_LIST.has(name)) for (const part of value.split(/\s+/)) take(part);
      else if (REFERENCE.has(name) || name === 'href' || name === 'xlink:href') take(value);
    }
    for (const value of Object.values(node.style)) for (const found of urlAliases(value)) take(found);
    for (const value of Object.values(node.tokens ?? {})) for (const found of urlAliases(value)) take(found);
    for (const child of node.children) if (holds(boundary, child)) walk(child);
  };

  walk(boundary.node);

  // Unmapped values pass through unchanged. A reference this walk never reached
  // — one inside a nested boundary, reaching back out — is left as the subject
  // alias it already was, which is visible and wrong in the same direction as
  // doing nothing, rather than silently colliding with a local slot.
  const rewrite = (value: string): string => local.get(value) ?? value;

  return {
    alias: rewrite,
    style: (value) =>
      value.replace(/url\(\s*(['"]?)#([^'")]+)\1\s*\)/g, (match, quote: string, id: string) => {
        const mapped = local.get(`#${id}`);
        return mapped === undefined ? match : `url(${quote}${mapped}${quote})`;
      }),
    attribute: (name, value) => {
      if (REFERENCE_LIST.has(name)) {
        return value
          .split(/\s+/)
          .map((part) => rewrite(part))
          .join(' ');
      }
      if (REFERENCE.has(name) || name === 'href' || name === 'xlink:href') return rewrite(value);
      return value;
    },
  };
}

function urlAliases(value: string): readonly string[] {
  return [...value.matchAll(/url\(\s*['"]?#([^'")]+)['"]?\s*\)/g)].map((match) => `#${match[1]}`);
}
