/**
 * What reaches what, stored so that asking is cheap.
 *
 * Every question this project asks about a change is a reachability question. A
 * diff names files; a subject is made of components; a component is declared in a
 * file that imports other files. *Which subjects could this diff have changed* is
 * one traversal of one graph, and the only reason it is not asked that way today
 * is that there has never been a graph to traverse.
 *
 * ## Why a structure rather than a `Map`
 *
 * The obvious shape is `Map<string, string[]>`, and it is wrong at the size this
 * runs at. A monorepo scan produces tens of thousands of files and several times
 * as many edges; the map holds one array object and one string copy per edge, and
 * a traversal chases a pointer for every step. What replaces it here is the
 * standard answer, and it is standard because nothing has beaten it:
 *
 * - **strings are interned once.** A node is an integer. Comparison is an integer
 *   compare, membership is an index into a byte array, and a visited set is a
 *   `Uint8Array` rather than a `Set<string>`.
 * - **edges are two typed arrays** in compressed-sparse-row form: `offset` says
 *   where a node's row starts, `target` holds the rows end to end. One node's
 *   edges are contiguous, so a traversal walks memory forwards instead of
 *   following pointers into the heap.
 * - **both directions are materialized.** *What does this depend on* and *what
 *   depends on this* are different questions, and a graph answering only the
 *   first makes the second a whole-graph scan. The transpose is a counting sort —
 *   one pass to count, one to place — so holding it costs `O(n + m)` once instead
 *   of `O(n + m)` per query.
 *
 * ## Edges point at what a thing depends on
 *
 * One convention, held everywhere: **`A → B` means A depends on B**, so a change
 * in B may move A. Every affected-set question is therefore a walk against the
 * arrows, which is what `dependentsOf` does, and every *what would I have to read
 * to understand this* question is a walk along them.
 *
 * It decides the direction of the less obvious edges too. A component is
 * `declared-in` the file that declares it — the component depends on the file and
 * not the other way round — so editing that file reaches the component in the
 * same traversal that reaches every importer.
 *
 * ## Nodes are typed, because files are not the last kind
 *
 * This ships with two kinds and the join between them: a `file` graph built from
 * imports, and the `component` nodes the source index already knows how to find.
 * That is deliberate rather than incidental. A component relation — *`TodoFooter`
 * renders `Chip`* — is another edge kind between nodes of another kind in this
 * same structure, and
 * [`composition.md`](../../../../docs/composition.md) already computes exactly
 * that relation from what a run rendered. One graph means the static answer and
 * the rendered answer are joinable rather than adjacent.
 *
 * ## What it is not
 *
 * **Not a build graph.** It has no notion of a task, an output or a cache key,
 * and it does not know what an install produced. `nx` and `turbo` own that layer,
 * and what reads them reads their answer rather than competing with it.
 *
 * **Not a resolver.** Nothing here opens a file or knows what a specifier means.
 * `core` performs no I/O (ADR-0006); the records this folds are somebody else's
 * disk.
 */

/** Node kinds, in id order. An id is an index into this, never the word. */
export const NODE_KINDS = ['file', 'component'] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

/**
 * Edge kinds, in id order.
 *
 * The distinctions are kept because they explain a finding. One of them also
 * decides a walk: `type` is erased by every compiler, so nothing behind it runs
 * and nothing behind it renders, and the default traversal leaves it out
 * (`RUNTIME_EDGES`). A caller whose question is about source rather than about a
 * runtime — a docgen that reads prop types, a type-check gate — passes
 * `EDGE_KINDS` and walks it.
 */
export const EDGE_KINDS = [
  /** `import x from './y'` — a value import. */
  'imports',
  /** `export … from './y'` — an import that also republishes. */
  'reexports',
  /** `import('./y')`, with a specifier that was a literal. */
  'dynamic',
  /** `import type { T } from './y'` — erased before anything renders. */
  'type',
  /** A stylesheet's `@import`, or a `url()` reaching a font or an image. */
  'asset',
  /** A component to the file that declares it. */
  'declared-in',
] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

/**
 * The edge kinds something at runtime can follow: every kind but `type`. The
 * default for a reach and for a closure, and the list a caller widens from.
 */
export const RUNTIME_EDGES: readonly EdgeKind[] = EDGE_KINDS.filter((kind) => kind !== 'type');

export interface Node {
  readonly kind: NodeKind;
  /** Repository-relative for a file; the identifier for a component. */
  readonly name: string;
}

export interface Relation {
  readonly from: Node;
  readonly to: Node;
  readonly kind: EdgeKind;
}

/** An index into `Relations.names`. Valid only against the graph it came from. */
export type NodeId = number;

/**
 * One direction of the edge set, compressed-sparse-row.
 *
 * Node `i`'s edges are `target[offset[i] … offset[i + 1])`, and `kind[j]`
 * describes `target[j]`. `offset` holds one more entry than there are nodes, so
 * the last row needs no special case.
 */
export interface Adjacency {
  readonly offset: Uint32Array;
  readonly target: Uint32Array;
  readonly kind: Uint8Array;
}

export interface Relations {
  /** Node names by id, ordered by kind and then by code unit. */
  readonly names: readonly string[];
  /** The `NODE_KINDS` index of each node. */
  readonly kinds: Uint8Array;

  /** What each node depends on. */
  readonly depends: Adjacency;
  /** What depends on each node — the transpose, materialized. */
  readonly dependents: Adjacency;

  /**
   * `1` where this node's outgoing edges could not be enumerated.
   *
   * A parse failure, a specifier that was not a literal, a file in a language
   * nothing here reads. It is *not* "this file has no dependencies", and the
   * difference is the whole safety argument: a file whose edges are unknown may
   * depend on anything that changed, so selection seeds the traversal with every
   * one of them (ADR-0002 — absent is not empty).
   */
  readonly unknown: Uint8Array;

  /**
   * Why, for each of those nodes, in the words whoever read the file used.
   *
   * Sparse — a repository the scan understands carries none of these — and kept
   * apart from the mask because the mask is what the inner loop tests and this is
   * what an operator reads. Without it, a run that observed forty subjects instead
   * of twelve can say *because eight files could not be read* and can never say
   * **which**, which is the difference between a fact and a work item.
   */
  readonly reasons: ReadonlyMap<NodeId, string>;

  /** `keyOf` to id — the interning table, kept for lookup. */
  readonly index: ReadonlyMap<string, NodeId>;

  /**
   * Per file, the files its run never reaches at any depth: what a mock
   * replaces for the whole of a test's run.
   *
   * Carried with the graph rather than handed to each walk, because the graph
   * crosses every seam a walk does and a table left behind at one of them is a
   * selection that quietly widened. Empty for a graph nobody tainted. A walk
   * against the arrows consults it: a file is moved by a change only when some
   * trail from the change arrives without crossing one of that file's shadows.
   */
  readonly shadows: ReadonlyMap<string, readonly string[]>;
}

/**
 * The lookup key for a node.
 *
 * Runtime only; nothing serializes this, and no code parses it back — the
 * separator only has to be injective, and it is, because a kind is one of two
 * fixed words and neither contains a `:`. A name that contains one is therefore
 * fine.
 *
 * The obvious separator is a NUL, and it is the wrong one: a source file
 * carrying that byte stops being text to `grep`, `file` and `git diff`, which is
 * a search finding nothing looking exactly like a search that returned nothing.
 * `tools/boundaries.check.ts` fails a build over it.
 */
export function keyOf(kind: NodeKind, name: string): string {
  return `${kind}:${name}`;
}

/** The id a node is known by in these relations, or `undefined` for a name the scan never met. */
export function idOf(relations: Relations, kind: NodeKind, name: string): NodeId | undefined {
  return relations.index.get(keyOf(kind, name));
}

/** The node an id names: its kind and name, or `undefined` past the end. */
export function nodeAt(relations: Relations, id: NodeId): Node | undefined {
  const name = relations.names[id];
  if (name === undefined) return undefined;
  return { kind: NODE_KINDS[relations.kinds[id]!]!, name };
}

/** Every node of one kind, as ids. Contiguous, because the order is kind-major. */
export function nodesOfKind(relations: Relations, kind: NodeKind): readonly NodeId[] {
  const wanted = NODE_KINDS.indexOf(kind);
  const found: NodeId[] = [];
  for (let id = 0; id < relations.kinds.length; id += 1) {
    if (relations.kinds[id] === wanted) found.push(id);
  }
  return found;
}

/**
 * Fold relations into the queryable form.
 *
 * Deterministic to the byte: nodes are ordered by kind and then by **code unit** —
 * never `localeCompare`, which would make an id a promise about `LANG` — and edges
 * are sorted and deduplicated, so two runs over the same records produce identical
 * arrays and a serialized graph is stable.
 *
 * `O(n log n + m log m)` for the two sorts and `O(n + m)` for everything else. The
 * transpose is a counting sort rather than a second pass over a map, which is why
 * both directions cost one build instead of one per query.
 */
export function relationsOf(input: {
  readonly relations: Iterable<Relation>;
  /**
   * Nodes whose outgoing edges are not fully known, and must be treated as such.
   *
   * A bare node says *this one is blind*. A pair says why, in whatever words the
   * reader of the file used — and the sentence is the half an operator can act on,
   * so it travels with the fact rather than being reconstructed from it.
   */
  readonly unknown?: Iterable<Node | readonly [Node, string]>;
  /** Nodes with no edges at all, which would otherwise be absent from the graph. */
  readonly isolated?: Iterable<Node>;
  /** Per file, the files its run never reaches; see {@link Relations.shadows}. */
  readonly shadows?: ReadonlyMap<string, readonly string[]>;
}): Relations {
  const relations = [...input.relations];
  const unknownNodes = [...(input.unknown ?? [])].map((entry) =>
    Array.isArray(entry) ? entry : ([entry, undefined] as const),
  ) as readonly (readonly [Node, string | undefined])[];

  const seen = new Map<string, Node>();
  const see = (node: Node): void => {
    const key = keyOf(node.kind, node.name);
    if (!seen.has(key)) seen.set(key, node);
  };

  for (const relation of relations) {
    see(relation.from);
    see(relation.to);
  }
  for (const [node] of unknownNodes) see(node);
  for (const node of input.isolated ?? []) see(node);

  // Kind-major, then code unit. Kind-major keeps one kind's nodes contiguous,
  // which is what lets a caller filter to files without touching a string.
  const ordered = [...seen.values()].sort(
    (a, b) =>
      NODE_KINDS.indexOf(a.kind) - NODE_KINDS.indexOf(b.kind) ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );

  const index = new Map<string, NodeId>();
  const names: string[] = Array.from<string>({ length: ordered.length });
  const kinds = new Uint8Array(ordered.length);

  for (const [id, node] of ordered.entries()) {
    index.set(keyOf(node.kind, node.name), id);
    names[id] = node.name;
    kinds[id] = NODE_KINDS.indexOf(node.kind);
  }

  const edges = sortedEdges(relations, index);
  const depends = adjacencyOf(edges, ordered.length, 'from');
  const dependents = adjacencyOf(edges, ordered.length, 'to');

  const unknown = new Uint8Array(ordered.length);
  const reasons = new Map<NodeId, string>();
  for (const [node, because] of unknownNodes) {
    const id = index.get(keyOf(node.kind, node.name));
    if (id === undefined) continue;

    unknown[id] = 1;
    if (because !== undefined) reasons.set(id, because);
  }

  return { names, kinds, depends, dependents, unknown, reasons, index, shadows: input.shadows ?? new Map() };
}

interface Edge {
  readonly from: NodeId;
  readonly to: NodeId;
  readonly kind: number;
}

/**
 * Edges as ids, sorted and deduplicated.
 *
 * Sorting the whole list once is what makes every row of *both* adjacencies
 * sorted without sorting any row: each fill walks the list in order, so a row
 * receives its targets in order. Two files related twice — a value import and a
 * type import — stay two edges, because the kinds differ and one of them explains
 * a finding the other does not.
 */
function sortedEdges(
  relations: readonly Relation[],
  index: ReadonlyMap<string, NodeId>,
): readonly Edge[] {
  const edges: Edge[] = [];

  for (const relation of relations) {
    const from = index.get(keyOf(relation.from.kind, relation.from.name));
    const to = index.get(keyOf(relation.to.kind, relation.to.name));
    if (from === undefined || to === undefined) continue;
    edges.push({ from, to, kind: EDGE_KINDS.indexOf(relation.kind) });
  }

  edges.sort((a, b) => a.from - b.from || a.to - b.to || a.kind - b.kind);

  const unique: Edge[] = [];
  for (const edge of edges) {
    const last = unique[unique.length - 1];
    const same =
      last !== undefined && last.from === edge.from && last.to === edge.to && last.kind === edge.kind;
    if (!same) unique.push(edge);
  }

  return unique;
}

/**
 * One direction, by counting sort.
 *
 * `by` names the endpoint a row is keyed on: `from` produces *what this depends
 * on*, `to` produces the transpose. Two passes — count the degrees, then place —
 * and no per-node array is ever allocated.
 */
function adjacencyOf(edges: readonly Edge[], nodes: number, by: 'from' | 'to'): Adjacency {
  const offset = new Uint32Array(nodes + 1);
  for (const edge of edges) offset[edge[by] + 1] = offset[edge[by] + 1]! + 1;
  for (let id = 0; id < nodes; id += 1) offset[id + 1] = offset[id + 1]! + offset[id]!;

  const target = new Uint32Array(edges.length);
  const kind = new Uint8Array(edges.length);
  const cursor = Uint32Array.from(offset.subarray(0, nodes));

  for (const edge of edges) {
    const row = edge[by];
    const at = cursor[row]!;
    target[at] = by === 'from' ? edge.to : edge.from;
    kind[at] = edge.kind;
    cursor[row] = at + 1;
  }

  return { offset, target, kind };
}
