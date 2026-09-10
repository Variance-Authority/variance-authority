/**
 * Walking the graph, and being able to say why the walk arrived.
 *
 * Two questions, one traversal each way:
 *
 * - **`dependentsOf`** — against the arrows. *What could this change have moved?*
 *   This is the one selection asks, and it is asked once per run over the whole
 *   seed set rather than once per seed, because a breadth-first search from many
 *   sources costs the same as one from a single source.
 * - **`dependenciesOf`** — along them. *What does this rest on?* The cache-key
 *   question, and the one a reviewer asks about a file they have not read.
 *
 * ## The trail is not an extra
 *
 * Both return the path each node was reached by, and that is load-bearing rather
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

import { EDGE_KINDS, type Adjacency, type EdgeKind, type NodeId, type Relations } from './graph.js';

/**
 * What one walk from a set of seeds reached: a mark over every node, the node
 * each one was reached through, and the reached ids in the order they were
 * found. `trailOf` reads the chain from any reached node back to its seed.
 */
export interface Reach {
  /** `1` where the node was reached, including the seeds themselves. */
  readonly mask: Uint8Array;
  /**
   * The node that reached each one, or `-1` for a seed and for anything
   * unreached. Following it lands on a seed, which is what `trailOf` walks.
   */
  readonly via: Int32Array;
  /** Reached nodes in id order, which is kind-major and then code unit. */
  readonly reached: readonly NodeId[];
}

export interface ReachOptions {
  /**
   * Edge kinds to walk. Every kind, when absent.
   *
   * The default is deliberately the widest one. Narrowing here is how a caller
   * says *a type-only import cannot have moved a pixel*, which is true and is
   * still not the default, because the cost of being wrong about it is a green
   * run over a surface nobody looked at.
   */
  readonly through?: Iterable<EdgeKind>;
}

/** What depends on these nodes, transitively. Against the arrows. */
export function dependentsOf(
  relations: Relations,
  seeds: Iterable<NodeId>,
  options: ReachOptions = {},
): Reach {
  return search(relations.dependents, relations.names.length, seeds, options);
}

/** What these nodes depend on, transitively. Along the arrows. */
export function dependenciesOf(
  relations: Relations,
  seeds: Iterable<NodeId>,
  options: ReachOptions = {},
): Reach {
  return search(relations.depends, relations.names.length, seeds, options);
}

/**
 * The chain from a reached node back to the seed that reached it.
 *
 * In arrival order — seed first, `id` last — because that is the direction the
 * sentence reads: *the token file, then the stylesheet, then the component*.
 * Empty when the node was never reached.
 */
export function trailOf(reach: Reach, id: NodeId): readonly NodeId[] {
  if (reach.mask[id] !== 1) return [];

  const trail: NodeId[] = [];
  for (let at: number = id; at !== -1; at = reach.via[at]!) trail.push(at);
  return trail.reverse();
}

/**
 * Breadth-first over one direction, from every seed at once.
 *
 * A plain array as the queue with a moving head rather than `shift()`, which is
 * `O(n)` per call in every engine that does not special-case it and turns a
 * linear traversal quadratic on the graphs this exists for.
 *
 * Breadth-first rather than depth-first for the trail's sake: the parent
 * recorded is then the one on a *shortest* path, so the explanation a run prints
 * is the shortest true one rather than whichever the stack happened to unwind.
 */
function search(
  adjacency: Adjacency,
  nodes: number,
  seeds: Iterable<NodeId>,
  options: ReachOptions,
): Reach {
  const mask = new Uint8Array(nodes);
  const via = new Int32Array(nodes).fill(-1);
  const queue: NodeId[] = [];

  for (const seed of seeds) {
    if (seed < 0 || seed >= nodes || mask[seed] === 1) continue;
    mask[seed] = 1;
    queue.push(seed);
  }

  const allowed = allowedKinds(options.through);

  for (let head = 0; head < queue.length; head += 1) {
    const node = queue[head]!;
    const end = adjacency.offset[node + 1]!;

    for (let at = adjacency.offset[node]!; at < end; at += 1) {
      if (allowed !== undefined && allowed[adjacency.kind[at]!] !== 1) continue;

      const next = adjacency.target[at]!;
      if (mask[next] === 1) continue;

      mask[next] = 1;
      via[next] = node;
      queue.push(next);
    }
  }

  // `queue` is in visit order, which depends on seed order. The result is in id
  // order instead, so a report built from it is byte-stable whatever order the
  // caller listed its changed files in.
  const reached: NodeId[] = [];
  for (let id = 0; id < nodes; id += 1) if (mask[id] === 1) reached.push(id);

  return { mask, via, reached };
}

/** A kind filter as a byte lookup, or `undefined` when every kind is walked. */
function allowedKinds(through: Iterable<EdgeKind> | undefined): Uint8Array | undefined {
  if (through === undefined) return undefined;

  const allowed = new Uint8Array(EDGE_KINDS.length);
  for (const kind of through) {
    const at = EDGE_KINDS.indexOf(kind);
    if (at !== -1) allowed[at] = 1;
  }
  return allowed;
}
