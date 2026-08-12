import type { CanonicalValue } from '../format/canonical.js';
import type { SemanticNode } from '../format/snapshot.js';

/**
 * Where one component's nodes stop and the next component's begin.
 *
 * Extracted from `component-hash.ts` on 2026-08-12, unchanged, because a second
 * reader arrived: {@link ./instances.js} needs the same walk and the same shape
 * function to produce a digest per *boundary* rather than per component name. A
 * copy would have been two definitions of what a component's own content is, and
 * the two would have disagreed within a month — the interesting one being
 * {@link LAYOUT_OUTPUT}, whose membership was measured rather than reasoned and
 * would have been re-derived wrong.
 *
 * Nothing here is exported from the package. The two callers are siblings.
 */

/** A node whose provenance chain broke. Not a filler category; see `RootKind`. */
export const UNATTRIBUTED = '(unattributed)';

/**
 * Properties whose *computed* value is layout output rather than authored input.
 *
 * The distinction this list exists for is not stylistic. Under a profile with a
 * layout engine the snapshot carries the engine's resolved values, so a block
 * element's computed `height` is whatever its contents made it — and a button
 * two levels down growing by six pixels moves the computed height of every
 * ancestor. Hashed as *style*, that reports every enclosing component as having
 * changed, which is precisely the "area ranks the displaced above the displacer"
 * failure the cause hashes exist to fix, arriving through a different door.
 *
 * Measured on `cases/storybook-case`: one padding edit inside `Button` made
 * `Tokens`, `Stack`, `Card` and the unattributed root all report a moved style
 * hash, so *every* component in every affected story was named a cause.
 *
 * They are folded into `geometry` instead, where "this component's box is a
 * different size" already belongs and where it correctly does not make a cause.
 * Under a profile *without* layout there are no computed values, so these are
 * authored declarations like any other and stay in `style` — that tier has no
 * `geometry` digest to move them to, and a declared `width: 100px` really is the
 * component's own content.
 */
export const LAYOUT_OUTPUT: ReadonlySet<string> = new Set([
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
  // The one nobody guesses, and the one that was actually doing the damage.
  // `transform-origin` computes to half the border box — `512px 41px` — so it
  // moves whenever the box does, on every element, including ones that declare
  // no transform at all. Removing `width` and `height` changed nothing on the
  // case measurement; removing this is what made a padding edit inside `Button`
  // stop naming `Tokens`, `Stack`, `Card` and the root as causes.
  'transform-origin',
  // Chromium returns *used* track sizes here — `"70.39px 953.61px"` — never the
  // author's `auto 1fr`, so nothing declared survives to be lost. That is what
  // makes these two safe on a list, and it is exactly what is not true of the
  // properties named below.
  'grid-template-columns',
  'grid-template-rows',
]);

/**
 * Five more shapes leak, and a longer list is the wrong fix. Measured.
 *
 * Editing only a descendant's padding in a real Chromium moves the computed
 * value of an ancestor's `padding-*` (percentage padding in a shrink-to-fit
 * box), `margin-*` (an `auto` margin centring a `fit-content` block),
 * `top`/`right`/`bottom`/`left` (an absolutely positioned element anchored to an
 * edge that moved) and `transform` (a `translate(-50%,-50%)` matrix, the exact
 * sibling of the `transform-origin` case above). Each one makes an enclosing
 * component a false cause.
 *
 * Adding them here was tried and is worse than the disease: with `padding-*` on
 * the list, `causes.test.ts`'s headline case — a padding edit *inside* `Button`
 * — stops naming `Button` at all. For these properties the computed value **is**
 * the authored value in the ordinary case, and a property name cannot tell the
 * two apart. Only a *value* can, and the only place that knows is `resolveStyle`
 * in `rules/normalize/cascade.ts`, which sees both the cascade's winner and the
 * engine's override and currently keeps no record of which superseded which.
 *
 * So the limit is stated rather than half-fixed: a component whose own
 * declarations use percentage padding, auto margins, edge-anchored absolute
 * positioning or a percentage translate can be named a cause by a change that
 * was not its own. The failure is a *false* cause, never a missed one, which is
 * the direction that costs a reader attention rather than a regression.
 */

/**
 * The component that owns a node: the nearest *enclosing* composite.
 *
 * `owners[0]` rather than `createdBy`. The two diverge where a component is
 * passed as a prop and rendered elsewhere, and the question here is where a node
 * *sits*, not who authored it — an area of the screen is bounded by what
 * encloses it. Attribution of a structural change to its author is the differ's
 * job and uses `createdBy` (ADR-0007).
 */
export function ownerOf(node: SemanticNode): string {
  return node.provenance?.owners[0]?.name ?? UNATTRIBUTED;
}

export interface Boundary {
  readonly node: SemanticNode;
  readonly component: string;
  /** The enclosing boundary's component, absent on the subject root. */
  readonly within?: string;
  /** Boundaries between this one and the subject root. The root is `0`. */
  readonly depth: number;
}

/**
 * Every boundary root in the subject, in document order.
 *
 * A boundary root is a node whose owner differs from its parent's, plus the
 * subject root itself. Collected in a separate pre-order pass rather than
 * discovered during hashing, so that instance order is document order exactly —
 * discovering them while walking would order them by boundary depth instead, and
 * "the second instance" would mean something different in a nested tree.
 */
export function boundaries(root: SemanticNode): readonly Boundary[] {
  const found: Boundary[] = [];

  const visit = (node: SemanticNode, parentOwner: string | null, depth: number): void => {
    const owner = ownerOf(node);
    const boundary = owner !== parentOwner;
    if (boundary) {
      found.push({
        node,
        component: owner,
        ...(parentOwner === null ? {} : { within: parentOwner }),
        depth,
      });
    }
    for (const child of node.children) visit(child, owner, boundary ? depth + 1 : depth);
  };

  visit(root, null, 0);
  return found;
}

export interface Shape {
  readonly structure: CanonicalValue;
  readonly semantics: CanonicalValue;
  readonly text: CanonicalValue;
  readonly style: CanonicalValue;
  readonly geometry: CanonicalValue;
  /** Child boundaries encountered, in document order. Not part of any digest. */
  readonly renders: readonly string[];
  /** Nodes this boundary owns, counting its own root. Not part of any digest. */
  readonly nodes: number;
  /**
   * Custom properties this boundary's own nodes resolved through, sorted.
   *
   * Not part of any digest — the *values* are already inside `style`, and the
   * names are carried beside it so a token that moved can be joined to the
   * components that read it. Off the boundary rather than off the subject on
   * purpose: every subject on a themed page resolves through every token in the
   * theme, so a subject-level list names them all and explains nothing.
   */
  readonly tokens: readonly string[];
}

/**
 * How a value that may carry a structural alias is rewritten before hashing.
 *
 * `undefined` for the per-name hashes, which have always hashed the alias the
 * normalizer assigned and must keep doing so byte for byte. Supplied by the
 * per-instance hashes, which need a boundary-local alias space — see
 * {@link ./instances.js}, where the argument for it lives.
 */
export interface Rename {
  readonly attribute: (name: string, value: string) => string;
  readonly style: (value: string) => string;
  readonly alias: (alias: string) => string;
}

/**
 * One boundary's content, stopping at nested boundaries.
 *
 * Where a child belongs to another component, the parent records a placeholder
 * naming it rather than descending. That is the whole design: a component's hash
 * moves when *its own* code changes, and adding, removing or reordering a child
 * component is the parent's own change while what that child renders internally
 * is not. Hashing whole subtrees instead would move every ancestor on any leaf
 * edit, and the page root would change on every commit.
 *
 * Paths are not hashed. A path is an address that shifts when an unrelated
 * sibling is inserted, so hashing one reports a change nobody made.
 */
export function shapeOf(
  node: SemanticNode,
  component: string,
  layout: boolean,
  rename?: Rename,
): Shape {
  const style: CanonicalValue[] = [];
  const geometry: CanonicalValue[] = [];
  const semantics: CanonicalValue[] = [];
  const text: CanonicalValue[] = [];
  const renders: string[] = [];
  const tokens = new Set<string>();
  let nodes = 0;

  const walk = (current: SemanticNode): CanonicalValue => {
    nodes += 1;
    for (const token of Object.keys(current.tokens ?? {})) tokens.add(token);
    const declared: Record<string, string> = {};
    const measured: Record<string, string> = {};

    for (const [property, value] of Object.entries(current.style)) {
      const resolved = rename === undefined ? value : rename.style(value);
      if (layout && LAYOUT_OUTPUT.has(property)) measured[property] = resolved;
      else declared[property] = resolved;
    }

    style.push({ style: declared, tokens: renamedTokens(current, rename) });
    // An entry per node, always. `null` for a node with no rect keeps position in
    // the list meaningful: dropping the entry would let two different trees agree
    // by coincidence.
    geometry.push({
      rect: current.rect ? { ...current.rect } : null,
      // Beside the rect, not instead of it. A computed `max-height` that changed
      // while the box did not is still a fact about this element's geometry, and
      // dropping it would make the two digests disagree about what a box is.
      ...(Object.keys(measured).length > 0 ? { measured } : {}),
    });

    // One entry per node in each list, always — `null` rather than omitted, for
    // the reason the geometry list gives: dropping an entry lets two different
    // trees agree by coincidence, and here it would let a heading losing its
    // name look like a heading that never had one.
    semantics.push({
      role: current.role ?? null,
      name: current.name ?? null,
      state: (current.state ?? null) as CanonicalValue,
    });
    text.push(current.text ?? null);

    return {
      tag: current.tag,
      alias: renamedAlias(current, rename),
      portalled: current.portalled,
      attributes: renamedAttributes(current, rename),
      children: current.children.map((child) => {
        const owner = ownerOf(child);
        if (owner === component) return walk(child);
        renders.push(owner);
        return { boundary: owner };
      }),
    };
  };

  const structure = walk(node);
  return {
    structure,
    semantics,
    text,
    style,
    geometry,
    renders,
    nodes,
    tokens: [...tokens].sort(),
  };
}

function renamedAlias(node: SemanticNode, rename?: Rename): string | undefined {
  if (rename === undefined || node.alias === undefined) return node.alias;
  return rename.alias(node.alias);
}

function renamedAttributes(
  node: SemanticNode,
  rename?: Rename,
): Readonly<Record<string, string>> {
  if (rename === undefined) return node.attributes;

  const renamed: Record<string, string> = {};
  for (const [name, value] of Object.entries(node.attributes)) {
    renamed[name] = rename.attribute(name, value);
  }
  return renamed;
}

function renamedTokens(
  node: SemanticNode,
  rename?: Rename,
): Readonly<Record<string, string>> | undefined {
  if (rename === undefined || node.tokens === undefined) return node.tokens;

  const renamed: Record<string, string> = {};
  for (const [name, value] of Object.entries(node.tokens)) {
    renamed[name] = rename.style(value);
  }
  return renamed;
}
