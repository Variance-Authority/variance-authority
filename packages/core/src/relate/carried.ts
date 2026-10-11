// compass: variance-authority.reach.relations
/**
 * The one walk against the arrows: what a change carries from the files it
 * started in to every file that loads one of them, and on.
 *
 * Every question about what a change reached is this walk with a different
 * step. A plain closure carries the whole file everywhere. A narrowed one
 * carries the exports that moved, and an importer that binds none of them is
 * not entered. Selection carries names to a reader and stops behind the
 * importer the record answers. The walk is the same each time — a worklist of
 * facts `(file, name)`, each fact entered once — so it is written once, here,
 * and each caller says only what one importer does with what reached it.
 * Handed the forward adjacency instead, the same walk runs along the arrows,
 * which is how `dependenciesOf` closes over what a file loads.
 *
 * ## What is carried
 *
 * A {@link Carry} is either {@link WHOLE} — the file moved as it loads, or
 * nobody can say which of its names did — or a map from the names that moved
 * to whatever the caller carries with each. An empty map is nothing, and
 * nothing arrives nowhere: the importer is not entered.
 *
 * ## The kernel owns
 *
 * - **the worklist** — first in, first out, so a node is first entered from a
 *   node on a shortest path and the trail through `via` is a shortest one;
 * - **what was entered** — the names each node holds only grow, a name is
 *   handed to a node once, and a node that holds the whole file takes nothing
 *   more. A name is held as a string, whichever file it arrived from: a caller
 *   that needs two files' `default` apart names them apart. The walk ends,
 *   whatever the steps return, after at most one entry per node and name, and
 *   one more when a node turns whole;
 * - **cycles** — a cycle, a self-import included, is a revisit like any other;
 * - **the step that cannot answer** — `undefined` from a step is
 *   {@link WHOLE}. A narrower walk has to be earned by an answer, so an
 *   unknown can only cost a wider one.
 */

import { EDGE_KINDS, RUNTIME_EDGES, type Adjacency, type EdgeKind, type NodeId } from './graph.js';

/** The whole file: every name it exposes, and what it does as it loads. */
export const WHOLE: unique symbol = Symbol('whole');
export type Whole = typeof WHOLE;

/** What reaches a node: the whole file, or the names that moved, each with the caller's payload. */
export type Carry<T> = ReadonlyMap<string, T> | Whole;

/** Nothing: the importer is not entered, and nothing is handed on from it. */
export const NOTHING: Carry<never> = new Map<string, never>();

/** What a node holds so far: the whole file, or the names handed to it. Live — read it, never keep it. */
export type Held = ReadonlySet<string> | Whole;

/**
 * What one importer does with what reached it. A step left out passes what it
 * was given on unchanged.
 */
export interface CarriedStep<T> {
  /**
   * What crosses one edge: `carried` left `from`, and `importer` loads `from`
   * through an edge of `kind` (an index into `EDGE_KINDS`). `held` is
   * everything `from` holds when it is expanded, which `carried` is part of.
   * {@link NOTHING} keeps the edge from entering `importer`; `undefined` is
   * the whole file.
   */
  arrive?(importer: NodeId, from: NodeId, kind: number, carried: Carry<T>, held: Held): Carry<T> | undefined;
  /**
   * What `importer` hands on, given what arrived that it did not already hold
   * — never empty. Asked once per new arrival, in the order the walk reaches
   * them, and never of a seed as it starts. {@link NOTHING} stops the walk
   * behind it; `undefined` hands on the whole file.
   */
  hand?(importer: NodeId, arrived: Carry<T>): Carry<T> | undefined;
}

export interface CarriedOptions {
  /** Edge kinds to walk. `RUNTIME_EDGES` when absent: every kind but `type`. */
  readonly through?: Iterable<EdgeKind>;
  /** Nodes the walk never enters, seeds included. */
  readonly avoid?: Iterable<NodeId>;
  /**
   * Marks to write into instead of a fresh array; `1` where a node was entered.
   * A node already marked when the walk starts counts as holding the whole
   * file, so it is neither entered nor handed anything.
   */
  readonly mask?: Uint8Array;
  /**
   * Where to record the node each one was first entered from. Not recorded
   * when absent. A seed's entry is left as it was, `-1` by convention.
   */
  readonly via?: Int32Array;
  /**
   * Whether a seed holds what it starts with. When `false` it holds nothing,
   * so what a cycle carries back to it is new, and handed to it: a file can
   * read its own names back through an importer.
   */
  readonly seedsHold?: boolean;
}

export interface Reached {
  /** `1` where a node was entered, including the seeds. */
  readonly mask: Uint8Array;
  /** The entered nodes, in the order they were first entered. */
  readonly entered: readonly NodeId[];
}

/**
 * Walk `edges` from `seeds`, each with what its change carries, and hand each
 * node it enters what reaches it through `step`. `edges` is the reverse
 * adjacency for what a change reaches, the forward one for what a file loads.
 */
export function carried<T>(
  edges: Adjacency,
  seeds: Iterable<readonly [NodeId, Carry<T>]>,
  step: CarriedStep<T> = {},
  options: CarriedOptions = {},
): Reached {
  const { offset, target, kind } = edges;
  const nodes = offset.length - 1;
  const mask = options.mask ?? new Uint8Array(nodes);
  const { via } = options;
  const allowed = allowedKinds(options.through);
  let avoided: Uint8Array | undefined;
  for (const id of options.avoid ?? []) {
    if (id < 0 || id >= nodes) continue;
    avoided ??= new Uint8Array(nodes);
    avoided[id] = 1;
  }

  // An entered node absent here holds the whole file.
  const partial = new Map<NodeId, Set<string>>();
  const entered: NodeId[] = [];
  const queue: Array<readonly [NodeId, Carry<T>]> = [];

  for (const [seed, carry] of seeds) {
    if (seed < 0 || seed >= nodes || mask[seed] === 1 || avoided?.[seed] === 1) continue;
    mask[seed] = 1;
    entered.push(seed);
    if (options.seedsHold === false) partial.set(seed, new Set());
    else if (carry !== WHOLE) partial.set(seed, new Set(carry.keys()));
    if (carry === WHOLE || carry.size > 0) queue.push([seed, carry]);
  }

  const enter = (next: NodeId, from: NodeId, carry: Carry<T>): void => {
    let arrived = carry;
    if (mask[next] !== 1) {
      mask[next] = 1;
      if (via !== undefined) via[next] = from;
      entered.push(next);
      if (carry !== WHOLE) partial.set(next, new Set(carry.keys()));
    } else {
      const held = partial.get(next);
      if (held === undefined) return;
      if (carry === WHOLE) {
        partial.delete(next);
      } else {
        const added = new Map<string, T>();
        for (const [name, payload] of carry) {
          if (held.has(name)) continue;
          held.add(name);
          added.set(name, payload);
        }
        if (added.size === 0) return;
        arrived = added;
      }
    }
    const out = step.hand === undefined ? arrived : (step.hand(next, arrived) ?? WHOLE);
    if (out === WHOLE || out.size > 0) queue.push([next, out]);
  };

  for (let head = 0; head < queue.length; head += 1) {
    const [node, carry] = queue[head]!;
    const held: Held = partial.size === 0 ? WHOLE : (partial.get(node) ?? WHOLE);
    const end = offset[node + 1]!;

    for (let edge = offset[node]!; edge < end; edge += 1) {
      const edgeKind = kind[edge]!;
      if (allowed[edgeKind] !== 1) continue;
      const next = target[edge]!;
      if (avoided?.[next] === 1) continue;
      const out = step.arrive === undefined ? carry : (step.arrive(next, node, edgeKind, carry, held) ?? WHOLE);
      if (out !== WHOLE && out.size === 0) continue;
      enter(next, node, out);
    }
  }

  return { mask, entered };
}

/**
 * The marked nodes in id order. The walk's own order depends on seed order;
 * this one does not, so a report built from it is byte-stable whatever order
 * the caller listed its changed files in.
 */
export function inIdOrder(mask: Uint8Array): NodeId[] {
  const visited: NodeId[] = [];
  for (let id = 0; id < mask.length; id += 1) if (mask[id] === 1) visited.push(id);
  return visited;
}

/**
 * A kind filter as a byte lookup, so the inner loop tests a byte; `fallback`
 * when no kinds are named.
 */
export function allowedKinds(
  through: Iterable<EdgeKind> | undefined,
  fallback: readonly EdgeKind[] = RUNTIME_EDGES,
): Uint8Array {
  const allowed = new Uint8Array(EDGE_KINDS.length);
  for (const name of through ?? fallback) {
    const at = EDGE_KINDS.indexOf(name);
    if (at !== -1) allowed[at] = 1;
  }
  return allowed;
}
