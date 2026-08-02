import type { CanonicalValue } from '../format/canonical.js';
import { digestValue, type Digest } from '../format/hash.js';
import type { SemanticNode, SemanticSnapshot } from '../format/snapshot.js';

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

export interface ComponentHash {
  readonly component: string;

  /** Boundaries of this component in the subject, counted in document order. */
  readonly instances: number;

  readonly structure: Digest;
  readonly style: Digest;

  /**
   * Absent under a profile without layout — absent, never empty (ADR-0002).
   *
   * An empty geometry digest would compare equal between a run that observed no
   * movement and a run that could not observe movement at all, which is the
   * false `unchanged` this system must never produce.
   */
  readonly geometry?: Digest;
}

/**
 * Hash every component boundary in a subject.
 *
 * Ordered by component name so an unchanged subject produces byte-identical
 * output across runs.
 */
export function hashComponents(snapshot: SemanticSnapshot): readonly ComponentHash[] {
  const layout = snapshot.profile.layout;

  const accumulated = new Map<
    string,
    { structure: CanonicalValue[]; style: CanonicalValue[]; geometry: CanonicalValue[] }
  >();

  for (const boundary of boundaries(snapshot.root)) {
    const shape = shapeOf(boundary.node, boundary.component);

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
    .sort((a, b) => a.component.localeCompare(b.component));
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
function shapeOf(node: SemanticNode, component: string): Shape {
  const style: CanonicalValue[] = [];
  const geometry: CanonicalValue[] = [];

  const walk = (current: SemanticNode): CanonicalValue => {
    style.push({ style: current.style, tokens: current.tokens });
    // `null` for a node with no rect keeps position in the list meaningful:
    // dropping the entry would let two different trees agree by coincidence.
    geometry.push(current.rect ? { ...current.rect } : null);

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
