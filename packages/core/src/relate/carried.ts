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
 * which is how `dependenciesOf` closes over what a file loads. One plain
 * closure is written again: `Graph::search` in sense's native journey graph,
 * because Rust cannot call this.
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

import { EDGE_KINDS, type Adjacency, type EdgeKind, type NodeId } from './graph.js';

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
   * everything `from` holds when it is expanded, which `carried` is part of:
   * the whole file when `carried` is, and a seed's starting names even when
   * `seedsHold` is `false`.
   * {@link NOTHING} keeps the edge from entering `importer`; `undefined` is
   * the whole file. Not asked of an edge into a node that already holds the
   * whole file, since nothing it returns could add to it.
   */
  arrive?(importer: NodeId, from: NodeId, kind: number, carried: Carry<T>, held: Held): Carry<T> | undefined;
  /**
   * What `importer` hands on, given what arrived that it did not already hold
   * — never empty. Asked once per new arrival, as the walk expands it, in the
   * order the walk reached them, and never of a seed as it starts. Every
   * arrival is asked, so a step that answers {@link NOTHING} for one importer
   * still sees each arrival that reached it. {@link NOTHING} stops the walk
   * behind it; `undefined` hands on the whole file.
   */
  hand?(importer: NodeId, arrived: Carry<T>): Carry<T> | undefined;
}

export interface CarriedOptions {
  /** Edge kinds to walk. Every kind when absent; `RUNTIME_EDGES` for what a run loads. */
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
 * A seed listed more than once starts with everything its listings carry.
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
  const allowed = options.through === undefined ? EVERY : allowedKinds(options.through);
  let avoided: Uint8Array | undefined;
  if (options.avoid !== undefined) {
    // A typed array ignores a write out of its range, so an id the graph does
    // not hold avoids nothing.
    for (const id of options.avoid) {
      avoided ??= new Uint8Array(nodes);
      avoided[id] = 1;
    }
  }

  // An entered node absent here holds the whole file.
  let partial: Map<NodeId, Set<string>> | undefined;
  // The worklist, one number an entry: the node itself when it carries the
  // whole file, `~k` when it carries names, held at `k` aside. Each entry is
  // what arrived, and is handed on as it is expanded: the same entries in the
  // same order as asking on arrival, with the edge loop left free of the step.
  // While every entry is a node's first, the worklist is the list of entered
  // nodes too, so a walk pushes one number a node and nothing else. The first
  // entry that is not a node's first sets `entered` apart, and from then on it
  // is kept on its own.
  const queued: number[] = [];
  let aside: Aside<T> | undefined;
  let entered: NodeId[] | undefined;
  const { arrive, hand } = step;

  const holdsNothing = options.seedsHold === false;
  for (const [seed, carry] of seeds) {
    if (seed < 0 || seed >= nodes || avoided?.[seed] === 1) continue;
    let start: Carry<T> = carry;
    if (mask[seed] !== 1) {
      mask[seed] = 1;
      entered?.push(seed);
      if (holdsNothing) (partial ??= new Map()).set(seed, new Set());
      else if (carry !== WHOLE) (partial ??= new Map()).set(seed, namesOf(carry));
    } else {
      // Marked before the walk, which holds the whole file, or listed again.
      const holds = partial?.get(seed);
      if (holds === undefined) continue;
      // A seed that holds nothing of what it starts with starts every listing.
      if (!holdsNothing) {
        if (carry === WHOLE) partial!.delete(seed);
        else start = addedTo(holds, carry);
      }
      if (start !== WHOLE && start.size === 0) continue;
      entered ??= nodesOf(queued, aside, []);
    }
    queued.push(start === WHOLE ? seed : named((aside ??= { nodes: [], carries: [] }), seed, start));
  }
  const starts = queued.length;

  // With no step on the edge and every seed whole, nothing is held by name
  // until a hand answers with names, and the walk runs in a loop of its own
  // until then: a closure and a cut walk are this loop, unslowed by the walks
  // that narrow.
  let from = 0;
  let handed: ReadonlyMap<string, T> | undefined;
  if (arrive === undefined && partial === undefined && aside === undefined) {
    const stop = wholeFrom(edges, queued, starts, step, mask, via, allowed, avoided);
    if (stop === undefined) return { mask, entered: queued };
    ({ head: from, carry: handed } = stop);
  }

  for (let head = from; head < queued.length; head += 1) {
    const entry = queued[head]!;
    const node = entry >= 0 ? entry : aside!.nodes[~entry]!;
    let carry: Carry<T> = entry >= 0 ? WHOLE : aside!.carries[~entry]!;
    if (handed !== undefined && head === from) carry = handed;
    else if (hand !== undefined && head >= starts) carry = step.hand!(node, carry) ?? WHOLE;
    if (carry !== WHOLE && carry.size === 0) continue;
    // What it holds, which what it carries is part of: a seed that holds
    // nothing of what it starts with still starts with it.
    const holds = carry === WHOLE ? undefined : partial?.get(node);
    let held: Held = holds ?? WHOLE;
    if (holdsNothing && head < starts && holds !== undefined && carry !== WHOLE) {
      const both = namesOf(carry);
      for (const name of holds) both.add(name);
      held = both;
    }
    const end = offset[node + 1]!;

    for (let edge = offset[node]!; edge < end; edge += 1) {
      const edgeKind = kind[edge]!;
      if (allowed[edgeKind] !== 1) continue;
      const next = target[edge]!;
      if (avoided?.[next] === 1) continue;
      // Entered and absent from `partial`: it holds the whole file already.
      const seen = mask[next] === 1;
      if (seen && (partial === undefined || !partial.has(next))) continue;

      const out = arrive === undefined ? carry : (step.arrive!(next, node, edgeKind, carry, held) ?? WHOLE);
      if (out !== WHOLE && out.size === 0) continue;
      let arrived = out;
      if (!seen) {
        mask[next] = 1;
        if (via !== undefined) via[next] = node;
        entered?.push(next);
        if (out !== WHOLE) (partial ??= new Map()).set(next, namesOf(out));
      } else {
        if (out === WHOLE) partial!.delete(next);
        else {
          arrived = addedTo(partial!.get(next)!, out);
          if (arrived.size === 0) continue;
        }
        entered ??= nodesOf(queued, aside, []);
      }
      queued.push(arrived === WHOLE ? next : named((aside ??= { nodes: [], carries: [] }), next, arrived));
    }
  }

  // Nothing carried by name, nothing to decode: every entry is a node.
  return { mask, entered: entered ?? (aside === undefined ? queued : nodesOf(queued, aside, queued)) };
}

/** Where a whole walk met a hand that answered with names, and the names. */
interface Handed<T> {
  readonly head: number;
  readonly carry: ReadonlyMap<string, T>;
}

/**
 * The walk while every entry carries the whole file: an entered node takes
 * nothing more, so the mask is the whole record of what was entered. Returns
 * where a hand first answered with names, or `undefined` when the walk ended
 * whole.
 */
function wholeFrom<T>(
  edges: Adjacency,
  queued: NodeId[],
  starts: number,
  step: CarriedStep<T>,
  mask: Uint8Array,
  via: Int32Array | undefined,
  allowed: Uint8Array,
  avoided: Uint8Array | undefined,
): Handed<T> | undefined {
  const { offset, target, kind } = edges;
  const asks = step.hand !== undefined;
  for (let head = 0; head < queued.length; head += 1) {
    const node = queued[head]!;
    if (asks && head >= starts) {
      const carry = step.hand!(node, WHOLE);
      if (carry !== undefined && carry !== WHOLE) {
        if (carry.size === 0) continue;
        return { head, carry };
      }
    }
    const end = offset[node + 1]!;
    for (let edge = offset[node]!; edge < end; edge += 1) {
      if (allowed[kind[edge]!] !== 1) continue;
      const next = target[edge]!;
      if (mask[next] === 1 || avoided?.[next] === 1) continue;
      mask[next] = 1;
      if (via !== undefined) via[next] = node;
      queued.push(next);
    }
  }
  return undefined;
}

/** What the worklist carries by name, out of line so a whole entry is one number. */
interface Aside<T> {
  readonly nodes: NodeId[];
  readonly carries: Array<ReadonlyMap<string, T>>;
}

/** The worklist entry for `node` carrying the names in `carry`. */
function named<T>(aside: Aside<T>, node: NodeId, carry: ReadonlyMap<string, T>): number {
  aside.carries.push(carry);
  return ~(aside.nodes.push(node) - 1);
}

/** The nodes of `entries`, written into `into`, which may be `entries` itself. */
function nodesOf<T>(entries: readonly number[], aside: Aside<T> | undefined, into: NodeId[]): NodeId[] {
  for (let at = 0; at < entries.length; at += 1) {
    const entry = entries[at]!;
    into[at] = entry >= 0 ? entry : aside!.nodes[~entry]!;
  }
  return into;
}

/** What `carry` adds to `holds`, which takes it in. */
function addedTo<T>(holds: Set<string>, carry: ReadonlyMap<string, T>): ReadonlyMap<string, T> {
  const added = new Map<string, T>();
  for (const [name, payload] of carry) {
    if (holds.has(name)) continue;
    holds.add(name);
    added.set(name, payload);
  }
  return added;
}

/**
 * The names a carry holds, as a set the walk grows. Added one by one: V8 builds
 * a `Set` from a map's key iterator several times slower than this loop.
 */
function namesOf<T>(carry: ReadonlyMap<string, T>): Set<string> {
  const names = new Set<string>();
  for (const name of carry.keys()) names.add(name);
  return names;
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

/** The default filter, built once: a walk runs once per changed file. */
const EVERY = allowedKinds(undefined);

/**
 * A kind filter as a byte lookup, so the inner loop tests a byte; `fallback`
 * when no kinds are named.
 */
export function allowedKinds(
  through: Iterable<EdgeKind> | undefined,
  fallback: readonly EdgeKind[] = EDGE_KINDS,
): Uint8Array {
  const allowed = new Uint8Array(EDGE_KINDS.length);
  for (const name of through ?? fallback) {
    const at = EDGE_KINDS.indexOf(name);
    if (at !== -1) allowed[at] = 1;
  }
  return allowed;
}
