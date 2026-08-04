import type { SemanticNode } from '../../format/snapshot.js';

/**
 * Node correspondence.
 *
 * Paths are positional, so inserting one sibling renumbers everything after it.
 * Diffing by path alone would report a single insertion as "every following node
 * changed" — the classic snapshot-test failure that trains people to stop
 * reading diffs. Matching therefore happens by identity first, content second,
 * and position last.
 *
 * The middle pass is the one that took three attempts to find. Identity keys
 * collapse whenever a node has no alias, no accessible name and no provenance —
 * five bare `<li>`s bucket together as `tag:li` — and pairing inside that bucket
 * by position turns a rotation into "every item's text changed". The corpus case
 * `reorder/list` was written to catch exactly that and could not: its assertions
 * were the verdict and the root count, and both are correct while the report is
 * useless. Scoring the *band* is what exposed it — five `text-changed` deltas
 * band as `content` where a rotation bands as `geometry`.
 */

export interface Matching {
  /** Baseline node → candidate node. */
  readonly pairs: ReadonlyMap<SemanticNode, SemanticNode>;
  readonly added: readonly SemanticNode[];
  readonly removed: readonly SemanticNode[];
  /**
   * Pairs whose position among their siblings changed *relative to each other*.
   *
   * Not "whose index differs". Prepending one item shifts every index after it
   * without reordering anything, and reporting three moves for one insertion is
   * the same fatigue that positional diffing produces. The moved set is the
   * complement of the longest run that stayed in order, which is the smallest
   * set of nodes whose movement explains the new sequence.
   */
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

const SIGNATURES = new WeakMap<SemanticNode, string>();

/**
 * What this subtree *says*, ignoring where it sits.
 *
 * Deliberately narrow: tag, the three ARIA fields, text, and the same of every
 * descendant. Style is excluded, because a node that was restyled and a node
 * that was replaced must not be confused — pairing by appearance would let a
 * recolour look like a substitution. Position is excluded because that is the
 * whole point.
 *
 * Cached per node: the recursion is O(subtree) and a parent computing it for
 * every child at every level would be quadratic in depth.
 */
function contentSignature(node: SemanticNode): string {
  const cached = SIGNATURES.get(node);
  if (cached !== undefined) return cached;

  const own = [node.tag, node.role ?? '', node.name ?? '', node.description ?? '', node.text ?? ''];
  const signature = `${own.join('')}(${node.children.map(contentSignature).join('')})`;

  SIGNATURES.set(node, signature);
  return signature;
}

/**
 * Content pass key. Scoped by identity so the refinement never crosses a
 * boundary the identity key drew — two components rendering the same string are
 * not the same node however identical their subtrees.
 */
function contentKey(node: SemanticNode): string {
  return `${matchKey(node)}\u0000${contentSignature(node)}`;
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
    const byContent = index(before.children, contentKey);
    const byIdentity = index(before.children, matchKey);
    const taken = new Set<number>();

    /** Baseline index each candidate paired with, indexed by candidate position. */
    const partner: (number | undefined)[] = Array.from(
      { length: after.children.length },
      () => undefined,
    );

    // Pass 1 — identical content. A node that says the same thing is the same
    // node, wherever it moved to.
    after.children.forEach((child, afterIndex) => {
      const claimed = claim(byContent.get(contentKey(child)), taken);
      if (claimed !== undefined) partner[afterIndex] = claimed;
    });

    // Pass 2 — whatever is left, by identity and then by order of appearance.
    // This is what turns `[a, b, c]` → `[a, x, c]` into one changed string
    // rather than one removal and one addition: `b` and `x` are the only two
    // nodes their bucket has left, so they are each other's counterpart.
    after.children.forEach((child, afterIndex) => {
      if (partner[afterIndex] !== undefined) return;
      const claimed = claim(byIdentity.get(matchKey(child)), taken);
      if (claimed !== undefined) partner[afterIndex] = claimed;
    });

    const sequence: number[] = [];
    after.children.forEach((child, afterIndex) => {
      const beforeIndex = partner[afterIndex];
      if (beforeIndex === undefined) {
        // Unmatched candidates are recorded whole. Their descendants are not
        // walked: a new subtree is one change to review, not one per node in it.
        added.push(child);
        return;
      }

      sequence.push(beforeIndex);
      const counterpart = before.children[beforeIndex]!;
      pairs.set(counterpart, child);
      matchChildren(counterpart, child);
    });

    for (const beforeIndex of outOfOrder(sequence)) {
      moved.add(before.children[beforeIndex]!);
    }

    before.children.forEach((child, index) => {
      if (!taken.has(index)) removed.push(child);
    });
  }
}

function index(
  children: readonly SemanticNode[],
  key: (node: SemanticNode) => string,
): Map<string, number[]> {
  const buckets = new Map<string, number[]>();

  children.forEach((child, position) => {
    const bucket = buckets.get(key(child));
    if (bucket) bucket.push(position);
    else buckets.set(key(child), [position]);
  });

  return buckets;
}

/** Lowest unclaimed index in a bucket, marking it claimed. */
function claim(bucket: number[] | undefined, taken: Set<number>): number | undefined {
  const free = bucket?.find((position) => !taken.has(position));
  if (free !== undefined) taken.add(free);
  return free;
}

/**
 * Indices that must have moved for `sequence` to be in this order.
 *
 * The complement of a longest increasing subsequence: everything in that
 * subsequence kept its relative order and needs no explanation, and what is left
 * is the smallest set of movements that produces the observed sequence. A
 * prepend leaves the sequence increasing and therefore reports nothing moved,
 * which is the answer `prepend/list` asks for — one added node, and not three
 * displaced siblings alongside it.
 */
function outOfOrder(sequence: readonly number[]): readonly number[] {
  if (sequence.length < 2) return [];

  // Patience sorting. `tails[k]` is the smallest tail of an increasing run of
  // length k+1; `previous` reconstructs which elements formed the longest one.
  const tails: number[] = [];
  const tailIndex: number[] = [];
  const previous: (number | undefined)[] = Array.from(
    { length: sequence.length },
    () => undefined,
  );

  for (let position = 0; position < sequence.length; position += 1) {
    const value = sequence[position]!;

    let low = 0;
    let high = tails.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (tails[mid]! < value) low = mid + 1;
      else high = mid;
    }

    tails[low] = value;
    tailIndex[low] = position;
    previous[position] = low > 0 ? tailIndex[low - 1] : undefined;
  }

  const kept = new Set<number>();
  let cursor: number | undefined = tailIndex[tails.length - 1];
  while (cursor !== undefined) {
    kept.add(cursor);
    cursor = previous[cursor];
  }

  return sequence.filter((_, position) => !kept.has(position));
}
