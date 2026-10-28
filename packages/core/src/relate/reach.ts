/**
 * Walking the graph, and being able to say why the walk arrived.
 *
 * Two questions, one traversal each way:
 *
 * - **`dependentsOf`** — against the arrows. *What could this change affect?*
 *   This is the one selection asks, and it is asked once per run over the whole
 *   seed set rather than once per seed, because a breadth-first search from many
 *   sources costs the same as one from a single source.
 * - **`dependenciesOf`** — along them. *What does this rest on?* The cache-key
 *   question, and the one a reviewer asks about a file they have not read.
 *
 * ## The trail is not an extra
 *
 * Both return the path to each node they visit, and that is load-bearing rather
 * than a convenience. A selector that says *observe 41 of 300* is asking to be
 * trusted; a selector that says *`Button` is affected because
 * `src/tokens.css` → `src/button.css` → `src/Button.tsx`* has shown its work, and
 * the operator can see the edge that is wrong when one is.
 *
 * Recording it costs one `Int32Array` and nothing in the inner loop — the parent
 * is written exactly where the visited mark already is.
 *
 * ## Cycles
 *
 * Import graphs have them, routinely and legitimately. Nothing here treats a
 * cycle as an error: the visited mask means every node is expanded once, so a
 * cycle terminates the same way any revisit does.
 */

import { carried, inIdOrder, WHOLE } from './carried.js';
import type { Adjacency, EdgeKind, NodeId, Relations } from './graph.js';
import { narrowed } from './narrow.js';

/**
 * What one walk from a set of seeds visited: a mark over every node, the node
 * each one was entered from, and the visited ids in id order. `trailOf` reads
 * the chain from any visited node back to its seed.
 */
export interface Traversal {
  /** `1` where the node was visited, including the seeds themselves. */
  readonly mask: Uint8Array;
  /**
   * The node each one was entered from, or `-1` for a seed and for anything
   * not visited. Walking it back lands on a seed, which is what `trailOf` does.
   */
  readonly via: Int32Array;
  /** Visited nodes in id order, which is kind-major and then code unit. */
  readonly nodes: readonly NodeId[];
}

export interface TraversalOptions {
  /**
   * Edge kinds to walk. Every kind when absent, `type` included.
   *
   * A type-only import is a dependency: a change behind it can break the
   * importer's types and a consumer's published declarations. Only a question
   * about what a run loads leaves it out, because nothing behind it runs: test
   * selection passes `RUNTIME_EDGES`. Any other list is walked exactly.
   */
  readonly through?: Iterable<EdgeKind>;
  /**
   * Nodes the walk never enters, seeds included.
   *
   * A module a test file mocks is replaced for that file's whole run, so a
   * question asked from the file's point of view is asked of a graph with the
   * module taken out — not one edge, the node. Marking it visited before the
   * walk starts is exactly that removal, at no cost in the inner loop.
   */
  readonly avoid?: Iterable<NodeId>;
  /**
   * Per seed, the exports its change moved; a seed absent is charged whole.
   * Read against the arrows only, and only over a graph that carries
   * {@link Relations.uses}: an importer is then entered only through a name it
   * uses ([`narrow.ts`](./narrow.ts)).
   */
  readonly moved?: ReadonlyMap<NodeId, readonly string[]>;
}

/** What depends on these nodes, transitively. Against the arrows. */
export function dependentsOf(
  relations: Relations,
  seeds: Iterable<NodeId>,
  options: TraversalOptions = {},
): Traversal {
  if (options.moved !== undefined && relations.uses !== undefined) {
    return narrowed(relations.dependents, relations.names, seeds, options.moved, relations.uses, options);
  }
  return search(relations.dependents, relations.names.length, seeds, options);
}

/** What these nodes depend on, transitively. Along the arrows. */
export function dependenciesOf(
  relations: Relations,
  seeds: Iterable<NodeId>,
  options: TraversalOptions = {},
): Traversal {
  return search(relations.depends, relations.names.length, seeds, options);
}

/**
 * The chain from a visited node back to the seed the walk started it from.
 *
 * In arrival order — seed first, `id` last — because that is the direction the
 * sentence reads: *the token file, then the stylesheet, then the component*.
 * Empty when the node was never visited.
 */
export function trailOf(traversal: Traversal, id: NodeId): readonly NodeId[] {
  if (traversal.mask[id] !== 1) return [];

  const trail: NodeId[] = [];
  for (let at: number = id; at !== -1; at = traversal.via[at]!) trail.push(at);
  return trail.reverse();
}

/**
 * Breadth-first over one direction, from every seed at once, carrying the whole
 * of each node to everything one edge away ([`carried.ts`](./carried.ts)).
 *
 * Breadth-first rather than depth-first for the trail's sake: the parent
 * recorded is then the one on a *shortest* path, so the explanation a run prints
 * is the shortest true one rather than whichever the stack happened to unwind.
 */
function search(
  adjacency: Adjacency,
  nodes: number,
  seeds: Iterable<NodeId>,
  options: TraversalOptions,
): Traversal {
  const via = new Int32Array(nodes).fill(-1);
  const whole = function* () {
    for (const seed of seeds) yield [seed, WHOLE] as const;
  };
  const { mask } = carried(adjacency, whole(), {}, { ...options, via });
  return { mask, via, nodes: inIdOrder(mask) };
}

