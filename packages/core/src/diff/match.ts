import type { SemanticNode } from '../snapshot.js';

/**
 * Node correspondence.
 *
 * Paths are positional, so inserting one sibling renumbers everything after it.
 * Diffing by path alone would report a single insertion as "every following node
 * changed" — the classic snapshot-test failure that trains people to stop
 * reading diffs. Matching therefore happens by identity first and position last.
 */

export interface Matching {
  /** Baseline node → candidate node. */
  readonly pairs: ReadonlyMap<SemanticNode, SemanticNode>;
  readonly added: readonly SemanticNode[];
  readonly removed: readonly SemanticNode[];
  /** Pairs whose index among their siblings changed. */
  readonly moved: ReadonlySet<SemanticNode>;
}

/**
 * Identity key, most specific first.
 *
 * Ordering matters: a structural alias is the strongest signal available because
 * it survives reordering and is stable across renders (that being the point of
 * ADR-0003's aliasing). Role plus accessible name is next, since it is what a
 * user of assistive technology would call the node. Owner chain plus tag comes
 * third — two `<span>`s rendered by the same component are interchangeable in a
 * way two spans from different components are not. Bare tag is the last resort.
 */
function matchKey(node: SemanticNode): string {
  if (node.alias !== undefined) return `alias:${node.alias}`;
  if (node.role !== undefined && node.name !== undefined) {
    return `aria:${node.role}|${node.name}`;
  }
  if (node.provenance && node.provenance.owners.length > 0) {
    const chain = node.provenance.owners.map((owner) => owner.name).join('>');
    return `own:${chain}:${node.tag}`;
  }
  return `tag:${node.tag}`;
}

export function matchTrees(baseline: SemanticNode, candidate: SemanticNode): Matching {
  const pairs = new Map<SemanticNode, SemanticNode>();
  const added: SemanticNode[] = [];
  const removed: SemanticNode[] = [];
  const moved = new Set<SemanticNode>();

  pairs.set(baseline, candidate);
  matchChildren(baseline, candidate);

  return { pairs, added, removed, moved };

  function matchChildren(before: SemanticNode, after: SemanticNode): void {
    const buckets = new Map<string, number[]>();
    before.children.forEach((child, index) => {
      const key = matchKey(child);
      const bucket = buckets.get(key);
      if (bucket) bucket.push(index);
      else buckets.set(key, [index]);
    });

    const takenBefore = new Set<number>();

    after.children.forEach((child, afterIndex) => {
      const bucket = buckets.get(matchKey(child));
      const beforeIndex = bucket?.shift();

      if (beforeIndex === undefined) {
        // Unmatched candidates are recorded whole. Their descendants are not
        // walked: a new subtree is one change to review, not one per node in it.
        added.push(child);
        return;
      }

      takenBefore.add(beforeIndex);
      const partner = before.children[beforeIndex]!;
      pairs.set(partner, child);
      if (beforeIndex !== afterIndex) moved.add(partner);
      matchChildren(partner, child);
    });

    before.children.forEach((child, index) => {
      if (!takenBefore.has(index)) removed.push(child);
    });
  }
}
