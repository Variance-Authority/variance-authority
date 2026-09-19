/**
 * The graph, hashed the way a build system hashes an action's inputs.
 *
 * Reachability answers *what could this diff have moved*. It needs a diff, which
 * means it needs `git`, a ref that exists, a checkout deep enough to contain it,
 * and the assumption that the ref is where this branch actually diverged. Every
 * one of those is a thing CI gets wrong, and each failure narrows a run.
 *
 * A Merkle digest asks a different question and needs none of them: **is this
 * subject's entire input closure byte-identical to the one that produced the
 * baseline?** One digest per node, over the node's own content and the digests of
 * everything it rests on — the same construction `bazel` uses to key an action,
 * and the same idea as this project's own content addressing, applied one level
 * out from the document to the source that produced it.
 *
 * What the difference buys:
 *
 * | situation | reachability | closure digest |
 * |---|---|---|
 * | a change, then a revert | both commits are in the diff, so it widens | identical digest, nothing runs |
 * | rebase, squash, branch switch | the merge base moves and the diff with it | unaffected — no ref is consulted |
 * | a shallow clone with no merge base | cannot answer; runs everything | unaffected |
 * | a dependency changed two hops away | reached, and observed | different digest, and observed |
 * | *why* a subject is being observed | a chain of files | a digest that differs |
 *
 * Neither replaces the other. The trail is the explanation, and the digest is the
 * proof; a run wants the digest to decide and the trail to justify.
 *
 * ## Cycles
 *
 * A dependency graph has them and a Merkle tree cannot. Strongly connected
 * components are condensed and hashed as a unit, so every file in a cycle carries
 * the same digest — which is exactly the truth about a cycle: no member of one can
 * be called unchanged while another moved.
 *
 * ## The digest that must never lie
 *
 * A digest says *these inputs are the same*. A file whose content was not supplied,
 * or whose own imports could not be read, breaks that claim — its closure may have
 * moved with no digest in this structure changing. Those nodes are marked
 * **volatile**, the mark propagates to everything that rests on them, and a
 * volatile node is treated as changed however its digest compares. A cache that
 * cannot be trusted must not be silently trusted.
 */

import { digestCombine, digestString, type Digest } from '../format/hash.js';
import {
  EDGE_KINDS,
  NODE_KINDS,
  keyOf,
  type EdgeKind,
  type NodeId,
  type Relations,
} from './graph.js';

export interface ClosureInput {
  readonly relations: Relations;

  /**
   * Content digest per file, keyed by the file's path.
   *
   * A file with no entry is volatile: nothing here can tell whether it moved.
   * Component nodes take no entry — a component has no bytes of its own, and its
   * content is the file that declares it, which it already depends on.
   */
  readonly content: ReadonlyMap<string, Digest>;

  /** Restrict the closure to these edge kinds. Every kind by default. */
  readonly through?: Iterable<EdgeKind>;
}

export interface Closure {
  /** `keyOf(kind, name)` → the digest of everything that node rests on. */
  readonly digests: ReadonlyMap<string, Digest>;

  /**
   * Nodes whose digest cannot prove sameness, and everything resting on them.
   *
   * Not an error. It is the honest half of the answer, and a caller that ignores
   * it converts a missing input into a subject nobody observed.
   */
  readonly volatile: ReadonlySet<string>;
}

/**
 * Hash every node over its own content and its whole dependency closure.
 *
 * One pass of Tarjan's algorithm and one pass over the components it emits, which
 * is `O(n + m)` — the same cost as the traversal next door, for an answer that
 * survives a rebase.
 */
export function closureOf(input: ClosureInput): Closure {
  const { relations, content } = input;
  const allowed = allowedKinds(input.through);
  const count = relations.names.length;

  const { component, order } = condense(relations, allowed);
  const digests = new Map<string, Digest>();
  const unstable = new Set<string>();

  // One digest per component, so every member of a cycle carries the same one.
  const byComponent: Digest[] = [];
  const shakyComponent: boolean[] = [];

  // Tarjan emits a component only after everything it can reach, so a dependency
  // digest is always already computed by the time it is read here.
  for (const [id, members] of order.entries()) {
    const terms: string[] = [];
    const outward = new Set<string>();
    let shaky = false;

    for (const node of members) {
      const kind = NODE_KINDS[relations.kinds[node]!]!;
      const name = relations.names[node]!;
      const own = kind === 'file' ? content.get(name) : SETTLED;

      if (own === undefined || relations.unknown[node] === 1) shaky = true;
      terms.push(`${kind}\u0000${name}\u0000${own ?? UNREAD}`);

      const { offset, target, kind: edgeKind } = relations.depends;
      for (let at = offset[node]!; at < offset[node + 1]!; at += 1) {
        if (allowed[edgeKind[at]!] !== 1) continue;

        const other = target[at]!;
        if (component[other] === id) continue;

        outward.add(`${EDGE_KINDS[edgeKind[at]!]!}\u0000${byComponent[component[other]!]!}`);
        if (shakyComponent[component[other]!] === true) shaky = true;
      }
    }

    byComponent.push(
      digestCombine('relate.closure', [
        digestString([...terms].sort(byCodeUnit).join('')),
        digestString([...outward].sort(byCodeUnit).join('')),
      ]),
    );
    shakyComponent.push(shaky);
  }

  for (let node = 0; node < count; node += 1) {
    const key = keyOf(NODE_KINDS[relations.kinds[node]!]!, relations.names[node]!);
    digests.set(key, byComponent[component[node]!]!);
    if (shakyComponent[component[node]!] === true) unstable.add(key);
  }

  return { digests, volatile: unstable };
}

/** The term a node with content contributes when the content is not known. */
const UNREAD = '(unread)';

/** The term a node that has no content of its own contributes. */
const SETTLED = '(declared)';

export interface Drift {
  /** Node keys whose closure is not provably the one it was. */
  readonly changed: readonly string[];
  /** The file paths among them. */
  readonly files: readonly string[];
  /** The component names among them. */
  readonly components: readonly string[];
  /** Node keys the earlier closure held and this one does not. */
  readonly gone: readonly string[];
}

/**
 * What moved between two closures, without consulting a repository.
 *
 * Three ways a node lands in `changed`, and only the first is a difference: its
 * digest differs, it is **new**, or it is **volatile** — the last because a node
 * whose inputs were not fully read has a digest that can match by accident, and a
 * selector that believed it would skip a subject on the strength of a hash over
 * bytes nobody hashed.
 */
export function driftedBetween(before: Closure, after: Closure): Drift {
  const changed: string[] = [];

  for (const [key, digest] of after.digests) {
    const was = before.digests.get(key);
    if (was === digest && !after.volatile.has(key) && !before.volatile.has(key)) continue;
    changed.push(key);
  }

  const gone = [...before.digests.keys()].filter((key) => !after.digests.has(key));

  return {
    changed: changed.sort(byCodeUnit),
    files: named(changed, 'file'),
    components: named(changed, 'component'),
    gone: gone.sort(byCodeUnit),
  };
}

function named(keys: readonly string[], kind: 'file' | 'component'): readonly string[] {
  const prefix = `${kind}:`;

  return keys
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length))
    .sort(byCodeUnit);
}

interface Condensation {
  /** Component index per node. */
  readonly component: Int32Array;
  /** Components in emission order — every one after everything it reaches. */
  readonly order: readonly (readonly NodeId[])[];
}

/**
 * Tarjan's strongly connected components, iteratively.
 *
 * Iterative because the recursion depth is the longest dependency chain in the
 * repository, and a deep monorepo would overflow a call stack on a structure whose
 * whole point is to be cheap. The emission order is the useful half: a component
 * appears only once everything it can reach has, which is the order a Merkle fold
 * needs and costs nothing extra to get.
 */
function condense(relations: Relations, allowed: Uint8Array): Condensation {
  const count = relations.names.length;
  const { offset, target, kind } = relations.depends;

  const index = new Int32Array(count).fill(-1);
  const low = new Int32Array(count);
  const onStack = new Uint8Array(count);
  const component = new Int32Array(count).fill(-1);

  const pending: NodeId[] = [];
  const order: NodeId[][] = [];

  // Frames as two parallel arrays: the node, and how far through its edges it is.
  const frameNode: number[] = [];
  const frameEdge: number[] = [];
  let counter = 0;

  for (let root = 0; root < count; root += 1) {
    if (index[root] !== -1) continue;

    index[root] = counter;
    low[root] = counter;
    counter += 1;
    pending.push(root);
    onStack[root] = 1;
    frameNode.push(root);
    frameEdge.push(offset[root]!);

    while (frameNode.length > 0) {
      const node = frameNode[frameNode.length - 1]!;
      const at = frameEdge[frameEdge.length - 1]!;

      if (at < offset[node + 1]!) {
        frameEdge[frameEdge.length - 1] = at + 1;
        if (allowed[kind[at]!] !== 1) continue;

        const next = target[at]!;
        if (index[next] === -1) {
          index[next] = counter;
          low[next] = counter;
          counter += 1;
          pending.push(next);
          onStack[next] = 1;
          frameNode.push(next);
          frameEdge.push(offset[next]!);
        } else if (onStack[next] === 1) {
          if (index[next]! < low[node]!) low[node] = index[next]!;
        }
        continue;
      }

      frameNode.pop();
      frameEdge.pop();

      const parent = frameNode[frameNode.length - 1];
      if (parent !== undefined && low[node]! < low[parent]!) low[parent] = low[node]!;

      if (low[node] !== index[node]) continue;

      const members: NodeId[] = [];
      for (;;) {
        const member = pending.pop()!;
        onStack[member] = 0;
        component[member] = order.length;
        members.push(member);
        if (member === node) break;
      }
      order.push(members.sort((a, b) => a - b));
    }
  }

  return { component, order };
}

/**
 * The edge kinds a closure walks when the caller does not say.
 *
 * Listed rather than derived from `EDGE_KINDS`, and the difference is the whole
 * point. A digest is a claim about *which inputs* were folded, so changing the
 * fold silently changes every digest that exists — one edge kind added or
 * removed, and the next run finds nothing it can prove unchanged and re-observes
 * the entire suite while reporting a successful narrowing. Changing this list is
 * a decision with a cost, and it should read like one.
 *
 * `type` is not in it: a type-only import is erased before a render, so a change
 * behind one is not an input the render folded.
 *
 * `depends-on` is not in it either, for the opposite reason. It runs between two
 * packages, and a package node is a name rather than a content digest — an
 * install that moved is a fact the diff carries, never one a hash of names could
 * reveal. Folding it would add a term that cannot change and a walk that cannot
 * answer.
 */
export const CLOSURE_EDGES: readonly EdgeKind[] = [
  'imports',
  'reexports',
  'dynamic',
  'asset',
  'declared-in',
];

/** Edge kinds as a lookup, so the inner loop tests a byte. */
function allowedKinds(through: Iterable<EdgeKind> | undefined): Uint8Array {
  const allowed = new Uint8Array(EDGE_KINDS.length);

  for (const kind of through ?? CLOSURE_EDGES) {
    const at = EDGE_KINDS.indexOf(kind);
    if (at !== -1) allowed[at] = 1;
  }

  return allowed;
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
