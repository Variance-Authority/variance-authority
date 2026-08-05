import type { CanonicalValue } from '../format/canonical.js';
import { digestValue } from '../format/hash.js';
import type { ComponentHash, SemanticNode, SemanticSnapshot } from '../format/snapshot.js';

export type { ComponentHash } from '../format/snapshot.js';

/**
 * Per-component content hashes, one per band.
 *
 * `SemanticSnapshot` hashes a whole subject. That answers "did anything change"
 * and nothing else: it moves whenever anything inside it moves, so it cannot say
 * *which area*, and a record built on it says "the page changed" on every commit.
 *
 * These hashes are the unit a history is kept in. Text, and small — a component
 * that did not change contributes the same digest it did last time, so the only
 * thing worth recording is the difference.
 */

/** A node whose provenance chain broke. Not a filler category; see `RootKind`. */
export const UNATTRIBUTED = '(unattributed)';

/**
 * Hash every component boundary in a subject.
 *
 * Ordered by component name so an unchanged subject produces byte-identical
 * output across runs.
 */
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
const LAYOUT_OUTPUT: ReadonlySet<string> = new Set([
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

export function hashComponents(snapshot: SemanticSnapshot): readonly ComponentHash[] {
  const layout = snapshot.profile.layout;

  const accumulated = new Map<
    string,
    { structure: CanonicalValue[]; style: CanonicalValue[]; geometry: CanonicalValue[] }
  >();

  for (const boundary of boundaries(snapshot.root)) {
    const shape = shapeOf(boundary.node, boundary.component, layout);

    const entry = accumulated.get(boundary.component) ?? {
      structure: [],
      style: [],
      geometry: [],
    };
    entry.structure.push(shape.structure);
    entry.style.push(shape.style);
    entry.geometry.push(shape.geometry);
    accumulated.set(boundary.component, entry);
  }

  return [...accumulated.entries()]
    .map(([component, entry]) => ({
      component,
      instances: entry.structure.length,
      structure: digestValue(entry.structure),
      style: digestValue(entry.style),
      ...(layout ? { geometry: digestValue(entry.geometry) } : {}),
    }))
    // Code-unit order, not `localeCompare`. The doc above promises byte-identical
    // output for an unchanged subject, and a locale-aware comparison makes that a
    // promise about the machine's `LANG` — which was tolerable while these were
    // internal and is not now that they are written into a sidecar, committed
    // beside a baseline, and read back on someone else's runner.
    .sort((a, b) => (a.component < b.component ? -1 : a.component > b.component ? 1 : 0));
}

/**
 * The component that owns a node: the nearest *enclosing* composite.
 *
 * `owners[0]` rather than `createdBy`. The two diverge where a component is
 * passed as a prop and rendered elsewhere, and the question here is where a node
 * *sits*, not who authored it — an area of the screen is bounded by what
 * encloses it. Attribution of a structural change to its author is the differ's
 * job and uses `createdBy` (ADR-0007).
 */
function ownerOf(node: SemanticNode): string {
  return node.provenance?.owners[0]?.name ?? UNATTRIBUTED;
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
function boundaries(root: SemanticNode): readonly { node: SemanticNode; component: string }[] {
  const found: { node: SemanticNode; component: string }[] = [];

  const visit = (node: SemanticNode, parentOwner: string | null): void => {
    const owner = ownerOf(node);
    if (owner !== parentOwner) found.push({ node, component: owner });
    for (const child of node.children) visit(child, owner);
  };

  visit(root, null);
  return found;
}

interface Shape {
  readonly structure: CanonicalValue;
  readonly style: CanonicalValue;
  readonly geometry: CanonicalValue;
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
function shapeOf(node: SemanticNode, component: string, layout: boolean): Shape {
  const style: CanonicalValue[] = [];
  const geometry: CanonicalValue[] = [];

  const walk = (current: SemanticNode): CanonicalValue => {
    const declared: Record<string, string> = {};
    const measured: Record<string, string> = {};

    for (const [property, value] of Object.entries(current.style)) {
      if (layout && LAYOUT_OUTPUT.has(property)) measured[property] = value;
      else declared[property] = value;
    }

    style.push({ style: declared, tokens: current.tokens });
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

    return {
      tag: current.tag,
      alias: current.alias,
      portalled: current.portalled,
      role: current.role,
      name: current.name,
      state: current.state as CanonicalValue | undefined,
      attributes: current.attributes,
      text: current.text,
      children: current.children.map((child) =>
        ownerOf(child) === component ? walk(child) : { boundary: ownerOf(child) },
      ),
    };
  };

  return { structure: walk(node), style, geometry };
}

/**
 * Which components *caused* a change, given both revisions' hashes.
 *
 * The arithmetic behind cause-first ranking, and the reason a baseline carries
 * its component hashes at all. `rankRegions` takes a list of cause names and,
 * given none, falls back to area — which
 * [journal 0013](../../../../docs/context/journal/0013-observability.md)
 * measured as backwards by 6×, because area measures displacement rather than
 * cause. This is where that list comes from on a path with no second document.
 *
 * The distinction is the split ADR-0018 built the bands for:
 *
 * - **`structure` or `style` moved** — the component's own content is different.
 *   It is a cause.
 * - **only `geometry` moved** — the component is byte-identical and its box is
 *   somewhere else. Something *else* moved it, so it is collateral, and naming
 *   it would send a reviewer to a file nobody edited.
 * - **appeared or disappeared** — a component present on one side only is a
 *   cause. Something decided to render it or to stop.
 *
 * `instances` is deliberately not consulted. A component rendered five times
 * instead of four has a different `structure` digest for the subject, and the
 * count moving on its own — the same component, the same content, one more of
 * them — is a change in whatever decided how many, not in this component.
 *
 * A profile with no layout supplies no `geometry`, so on that tier every
 * difference is `structure` or `style` and every changed component is a cause.
 * That is correct rather than degraded: with no boxes, nothing was displaced.
 */
export function causesBetween(
  before: readonly ComponentHash[],
  after: readonly ComponentHash[],
): readonly string[] {
  const previous = new Map(before.map((entry) => [entry.component, entry]));
  const causes: string[] = [];

  for (const entry of after) {
    // `(unattributed)` is not a component and can never be a cause. It is the
    // bucket for nodes whose provenance chain broke, so it collects unrelated
    // parts of a page under one name — and nothing downstream could act on it
    // anyway: a region with no owner reports no component, so it would never
    // match. A broken chain is a defect in this tool and is reported as
    // `unattributed` where that means something, not smuggled in here as a
    // culprit.
    if (entry.component === UNATTRIBUTED) continue;

    const was = previous.get(entry.component);
    if (was === undefined) {
      causes.push(entry.component);
      continue;
    }
    if (was.structure !== entry.structure || was.style !== entry.style) {
      causes.push(entry.component);
    }
  }

  // Removals too, and they are the case a candidate-only walk cannot see: a
  // component that stopped rendering leaves regions behind it, and the component
  // that used to be there is exactly the name a reviewer needs.
  const present = new Set(after.map((entry) => entry.component));
  for (const entry of before) {
    if (entry.component === UNATTRIBUTED) continue;
    if (!present.has(entry.component)) causes.push(entry.component);
  }

  return causes.sort();
}
