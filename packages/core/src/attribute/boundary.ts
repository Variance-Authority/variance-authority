import type { CanonicalValue } from '../format/canonical.js';
import type { Digest } from '../format/hash.js';
import type { SemanticNode } from '../format/snapshot.js';

/**
 * Where one component's nodes stop and the next component's begin.
 *
 * Two relations run upward out of a rendered node and they are not the same
 * relation. **Parent** is what is above it — React's `return` chain, the boxes
 * it ended up inside. **Owner** is what rendered it — React's `_debugOwner`, the
 * code that wrote the element. A layout wrapper is the parent of everything
 * handed to it and the owner of none of it.
 *
 * Both are needed here, for different halves of the same answer:
 *
 * - **Parent decides nesting.** A boundary owns a contiguous region of the
 *   document, and what encloses that region is a fact about the tree. Reading
 *   the owner for this would produce a boundary set that is not a partition.
 * - **Owner decides membership and naming.** A component's own content is what
 *   *it* wrote. Content it was handed is a hole in its output — present, sized,
 *   positioned by it, and authored somewhere else.
 *
 * Reading the parent for both — which is what a walk over `owners[0]` does — has
 * two consequences, and they are the two shapes a design system is made of:
 *
 * - **A component that renders only components disappears.** It authors no host
 *   node, so it is never any node's nearest enclosing composite, so it is a
 *   boundary nowhere. That is every variant wrapper (`DangerButton` returning a
 *   `Button`) and every page-level assembly. The information is not missing —
 *   the composite is in the chain, one rung up — it is discarded by reading only
 *   the head of it. {@link boundaries} enters every rung the chain crosses.
 * - **A container absorbs its caller's content.** `Card` renders one `div` and
 *   whatever it was given; hashed by enclosure, its digest moves whenever a
 *   caller passes something else, while its props digest — which excludes
 *   `children` — says its inputs held. {@link shapeOf} names a child boundary
 *   only when this component placed it, and leaves an anonymous hole otherwise.
 *
 * The owner half is a development-build artefact: React populates `_debugOwner`
 * from `element._owner`, and a production bundle does not. Absent, both rules
 * degrade to naming everything, which is the enclosure answer — coarser, never
 * wrong in a new direction.
 *
 * Nothing here is exported from the package. The callers are siblings.
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
 * Every component holding a node, outermost first, and who placed each one.
 *
 * The whole chain, not its head. `TodoFooter` rendering nothing but a `Stack`
 * appears here at the rung below `Stack`, which is the only place it appears at
 * all — it authors no element, so no node has it as a nearest enclosing
 * composite, and a walk that reads `owners[0]` cannot see it.
 *
 * `placedBy[i]` is who wrote the element for `stack[i]`: `OwnerFrame.createdBy`,
 * which is the component that decided a `<Stack>` belongs at this point, as
 * distinct from `Stack` itself. Absent per rung on a production build.
 *
 * A host node whose author is not the innermost component is content that was
 * handed in: it sits inside the container's box and belongs to whoever wrote it,
 * so the author is pushed as a further rung. That keeps the boundary set a
 * partition of the document — the slotted region is nested inside the container
 * rather than lifted out of it — while attributing it to the code responsible.
 */
interface Ownership {
  readonly stack: readonly string[];
  readonly placedBy: readonly (string | undefined)[];
  readonly props: readonly (Digest | undefined)[];
}

function ownershipOf(node: SemanticNode): Ownership {
  const owners = node.provenance?.owners;
  if (owners === undefined || owners.length === 0) {
    return { stack: [UNATTRIBUTED], placedBy: [undefined], props: [undefined] };
  }

  const stack: string[] = [];
  const placedBy: (string | undefined)[] = [];
  const props: (Digest | undefined)[] = [];
  for (let index = owners.length - 1; index >= 0; index -= 1) {
    const frame = owners[index]!;
    stack.push(frame.name);
    placedBy.push(frame.createdBy);
    props.push(frame.propsDigest);
  }

  // FIXME: what should this name when the author is a slot?
  //
  // Radix `Slot` under `asChild` merges the caller's className onto the child's
  // own host node, so `<Button asChild><Link/></Button>` renders one `<a>` whose
  // author is next/link's `LinkComponent` and whose every styling decision came
  // from `Button`. The owner rule then reports a name out of `node_modules` for a
  // region an edit to `button.tsx` moved, and both halves are individually
  // correct: `Button` really did author no host node, and `LinkComponent` really
  // did write the one that moved.
  //
  // Open, because the naive fix is worse. Preferring the nearest caller whenever
  // the author is unfamiliar would credit every container with its children's
  // changes, which is exactly the enclosure answer the owner rule exists to
  // refuse. Whether a slot is distinguishable from an ordinary hand-off at this
  // rung has not been read — `Slot` is a component like any other from here.
  const author = node.provenance?.createdBy;
  if (author !== undefined && author !== stack.at(-1)) {
    // A slotted region received no props of its own: it is markup, handed over
    // whole. Absent rather than the container's digest, which would claim the
    // author was called with inputs it never saw.
    stack.push(author);
    placedBy.push(author);
    props.push(undefined);
  }

  return { stack, placedBy, props };
}

/** How many rungs two stacks agree on, from the outside in. */
function sharedRungs(a: readonly string[], b: readonly string[]): number {
  const limit = Math.min(a.length, b.length);
  let shared = 0;
  while (shared < limit && a[shared] === b[shared]) shared += 1;
  return shared;
}

export interface Boundary {
  readonly node: SemanticNode;
  readonly component: string;
  /** The enclosing boundary's component, absent on the subject root. */
  readonly within?: string;
  /** Boundaries between this one and the subject root. The root is `0`. */
  readonly depth: number;
  /**
   * This component's rung in the node's ownership stack.
   *
   * Distinct from `depth`, which counts enclosing boundaries. They diverge
   * wherever a subject root has no provenance: the `(unattributed)` container is
   * a boundary at depth 0 holding a stack of one, and the application inside it
   * starts again at rung 0 while sitting at depth 1.
   */
  readonly rung: number;
  /**
   * Digest of the props this boundary received, from its own `OwnerFrame`.
   *
   * Read at this rung rather than from `owners[0]`, which is the innermost
   * component and belongs to whichever boundary is deepest at this node — the
   * distinction only exists because several boundaries can share a root.
   */
  readonly props?: Digest;
  /** The component whose JSX placed this one. Absent on a production build. */
  readonly placedBy?: string;
}

/** Whether a node's own content belongs to this boundary rather than one below. */
export function holds(boundary: Boundary, node: SemanticNode): boolean {
  const { stack } = ownershipOf(node);
  return stack.length === boundary.rung + 1 && stack[boundary.rung] === boundary.component;
}

/**
 * Every boundary root in the subject, in document order.
 *
 * A boundary opens at each rung a node's ownership stack adds to its parent's,
 * plus the subject root. Several can open at one node — a page assembly, the
 * card it returns and the stack inside that card all begin at the same element —
 * which is what makes a component that renders only components visible.
 *
 * Collected in a separate pre-order pass rather than discovered during hashing,
 * so that instance order is document order exactly. Discovering them while
 * walking would order them by boundary depth instead, and "the second instance"
 * would mean something different in a nested tree.
 */
export function boundaries(root: SemanticNode): readonly Boundary[] {
  const found: Boundary[] = [];

  const visit = (
    node: SemanticNode,
    parent: readonly string[] | null,
    enclosing: string | null,
    depth: number,
  ): void => {
    const { stack, placedBy, props } = ownershipOf(node);
    const opened = parent === null ? 0 : sharedRungs(parent, stack);

    let within = enclosing;
    let below = depth;
    for (let rung = opened; rung < stack.length; rung += 1) {
      const digest = props[rung];
      const placer = placedBy[rung];
      found.push({
        node,
        component: stack[rung]!,
        ...(within === null ? {} : { within }),
        depth: below,
        rung,
        ...(digest === undefined ? {} : { props: digest }),
        ...(placer === undefined ? {} : { placedBy: placer }),
      });
      within = stack[rung]!;
      below += 1;
    }

    for (const child of node.children) visit(child, stack, within, below);
  };

  visit(root, null, null, 0);
  return found;
}

export interface Shape {
  readonly structure: CanonicalValue;
  readonly semantics: CanonicalValue;
  readonly text: CanonicalValue;
  readonly style: CanonicalValue;
  readonly geometry: CanonicalValue;

  /**
   * How the framework holds this boundary, per node that reports it.
   *
   * Its own band because it answers its own question. `structure` through
   * `geometry` all read what the renderer produced; this reads what the
   * component *is* — its hook shape, its wrappers, the contexts it subscribes
   * to, the keys it is reconciled under. Two components can agree on all five
   * content bands and disagree here, and when they do, they behave differently
   * under every change that follows.
   */
  readonly wiring: CanonicalValue;

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
 * Where a child belongs to another component, this records a placeholder rather
 * than descending. That is the whole design: a component's hash moves when *its
 * own* code changes, and what a child renders internally is not that. Hashing
 * whole subtrees instead would move every ancestor on any leaf edit, and the
 * page root would change on every commit.
 *
 * **The placeholder names the child only when this component placed it.** A
 * component that wrote `<Stack>` owns that choice, and swapping it for a `<Card>`
 * is its own change; a container that was handed a `<Stack>` chose nothing, and
 * naming it would make the container's digest a function of its callers. So a
 * slot is anonymous, and `Card` renders the same bytes on every page that uses
 * it, whatever it was given. The cost is stated in ADR-0035: the *number* of
 * slotted children still reaches the digest, so a caller passing three where it
 * passed two moves the container.
 *
 * Falls back to naming every child where `_debugOwner` is absent, which is the
 * enclosure answer this replaced.
 *
 * Paths are not hashed. A path is an address that shifts when an unrelated
 * sibling is inserted, so hashing one reports a change nobody made.
 */
export function shapeOf(boundary: Boundary, layout: boolean, rename?: Rename): Shape {
  const { node, component, rung } = boundary;
  const style: CanonicalValue[] = [];
  const geometry: CanonicalValue[] = [];
  const semantics: CanonicalValue[] = [];
  const text: CanonicalValue[] = [];
  const wiring: CanonicalValue[] = [];
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
    // `null` for a node that reports none, for the reason every list here gives:
    // an omitted entry lets two different trees agree by coincidence. Most nodes
    // report `null` — wiring attaches to a component's root node and not to the
    // elements beneath it (see `wiringOf`), so a boundary's band is a short
    // signal in a long run of nulls, and the nulls are what make its position
    // mean anything.
    wiring.push((current.wiring ?? null) as CanonicalValue);

    return {
      tag: current.tag,
      alias: renamedAlias(current, rename),
      portalled: current.portalled,
      attributes: renamedAttributes(current, rename),
      children: current.children.map((child) => entry(child)),
    };
  };

  /**
   * Every node inside one boundary carries the same stack, by construction.
   *
   * So the comparison a child is measured against is fixed for the whole walk,
   * and a zero-node boundary — a component that renders only components, whose
   * root node already belongs to the boundary below it — measures against the
   * same thing.
   */
  const home = ownershipOf(node).stack.slice(0, rung + 1);

  /**
   * A node's contribution: its own content, or a stand-in for what is beneath.
   *
   * The rung a child leaves at is where its stack stops agreeing with `home` —
   * normally the next rung down, and shallower wherever a subject root carries
   * no provenance and the application starts again inside it.
   */
  const entry = (child: SemanticNode): CanonicalValue => {
    if (holds(boundary, child)) return walk(child);

    const own = ownershipOf(child);
    const left = sharedRungs(home, own.stack);
    const beneath = own.stack[left] ?? own.stack.at(-1) ?? UNATTRIBUTED;
    // Kept whichever way the digest goes: the edge is a true fact about the
    // document, and the graph wants it even where the hash must not carry it.
    renders.push(beneath);

    const placer = own.placedBy[left];
    return placer === undefined || placer === component ? { boundary: beneath } : { slot: null };
  };

  const structure = entry(node);
  return {
    structure,
    semantics,
    text,
    style,
    geometry,
    wiring,
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
