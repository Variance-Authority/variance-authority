/**
 * One file's outgoing edges, and the fold that turns a pile of them into a graph.
 *
 * A record is what reading **one** file produced, and that is the unit on
 * purpose. It makes the expensive half — open, parse, resolve — cacheable by
 * content digest and parallelizable per file, and it leaves the graph a pure
 * function of the records, so the structure can be rebuilt, sharded or merged
 * without touching a disk. `core` performs no I/O (ADR-0006); whoever owns the
 * disk produces these and hands them over.
 *
 * ## An empty record and an unreadable one are different facts
 *
 * A file with no imports and a file nothing could parse both produce a record
 * with no edges, and treating them alike is the one mistake that turns this from
 * a saving into a silent hole: the second one may import anything, including
 * whatever just changed. So `unknown` carries the *reason* the edges are not
 * known, and every consumer seeds its traversal with those files (ADR-0002 —
 * absent is not empty, and here absent is not even absent, it is *unread*).
 */

import type { Digest } from '../format/hash.js';
import {
  idOf,
  nodeAt,
  relationsOf,
  type EdgeKind,
  type Node,
  type NodeId,
  type Relation,
  type Relations,
} from './graph.js';
import { dependenciesOf, dependentsOf, trailOf, type Reach, type ReachOptions } from './reach.js';

export interface FileEdge {
  /** Repository-relative, already resolved. A specifier is not an edge. */
  readonly to: string;
  readonly kind: EdgeKind;
}

export interface FileRecord {
  /** Repository-relative, so a graph is portable between machines and CI. */
  readonly file: string;

  /**
   * The content digest this record was read from.
   *
   * Two jobs. It lets a second scan skip the parse for a file that has not moved,
   * which is the difference between a scan that costs a second and one nobody
   * leaves enabled. And it is the leaf of the Merkle fold in
   * [`merkle.ts`](./merkle.ts) — a file with no digest is one nothing can prove
   * unchanged, and is marked as such rather than assumed still.
   */
  readonly digest?: Digest;

  /** Resolved outgoing edges. Absent and empty mean the same thing here. */
  readonly edges?: readonly FileEdge[];

  /** Component names this file declares, from `indexSource` or better. */
  readonly declares?: readonly string[];

  /**
   * Specifiers that were read but did not resolve.
   *
   * Kept for the report rather than for the graph. A bare specifier that failed
   * to resolve is usually a package that is not installed; a **relative** one
   * that failed is a hole, and whoever produced the record says so by also
   * setting `unknown`.
   */
  readonly unresolved?: readonly string[];

  /**
   * Why this file's outgoing edges could not be enumerated, when they could not.
   *
   * Present means *this file may depend on anything*. The sentence is carried
   * rather than a flag, because it ends up in the paragraph explaining why a run
   * observed more than the operator expected.
   */
  readonly unknown?: string;
}

const file = (name: string): Node => ({ kind: 'file', name });
const component = (name: string): Node => ({ kind: 'component', name });

/**
 * Fold file records into the graph.
 *
 * Every record contributes its own node even when it has no edges, so a changed
 * file that imports nothing is still findable — otherwise the one file in the
 * diff would be missing from the structure that exists to answer questions about
 * it.
 *
 * A declaration becomes an edge from the **component to the file**, which is the
 * direction the convention requires: the component depends on the file that
 * declares it, so one walk against the arrows from a changed file reaches every
 * importer and every component in the same pass.
 */
export function relationsOfFiles(records: Iterable<FileRecord>, options: RelationsOptions = {}): Relations {
  const relations: Relation[] = [];
  const isolated: Node[] = [];
  const unknown: (readonly [Node, string])[] = [];

  for (const record of records) {
    const from = file(record.file);
    isolated.push(from);

    for (const edge of record.edges ?? []) {
      relations.push({ from, to: file(edge.to), kind: edge.kind });
    }
    for (const name of record.declares ?? []) {
      relations.push({ from: component(name), to: from, kind: 'declared-in' });
    }
    // The sentence travels with the node. Reduced to a flag here, the paragraph
    // this record exists to produce could name a count and never a cause.
    if (record.unknown !== undefined) unknown.push([from, record.unknown]);
  }

  return relationsOf({ relations, isolated, unknown, ...(options.shadows === undefined ? {} : { shadows: options.shadows }) });
}

export interface RelationsOptions {
  /** Per file, the files its run never reaches; see {@link Relations.shadows}. */
  readonly shadows?: ReadonlyMap<string, readonly string[]>;
}

export interface Hole {
  /** The file whose outgoing edges could not be enumerated. */
  readonly file: string;
  /** Why, in the words of whoever read it. Absent when nobody said. */
  readonly because?: string;
}

export interface Reached {
  /** Files the change could have moved, including the changed files themselves. */
  readonly files: readonly string[];
  /** Components declared in any of them. */
  readonly components: readonly string[];

  /**
   * Changed paths the graph does not hold.
   *
   * Never silently ignored. A `README.md` belongs here and means nothing; a
   * source file belongs here only because the scan never reached it, and the
   * caller — which knows where it told the scan to look — is the one that can
   * tell those apart.
   */
  readonly missing: readonly string[];

  /**
   * Files seeded because their own edges are unknown, rather than because
   * anything reached them, each with the reason it could not be read.
   *
   * Counted separately so that "we widened" never hides inside "we found", and
   * carrying its sentence so the widening is a work item rather than a tax: *four
   * files could not be read* is something to live with, and ``src/legacy.js — a
   * computed require()`` is something to fix.
   */
  readonly opaque: readonly Hole[];

  /**
   * Files the graph reached and their own shadows cut: every trail from a
   * changed file to each one crossed a module the file replaces for its run.
   * Listed so the report can say a test was left out and by whose word.
   */
  readonly shadowed: readonly string[];

  /** The traversal, kept so a caller can ask how any one file was reached. */
  readonly reach: Reach;
}

export interface MovedOptions extends ReachOptions {
  /**
   * Per file, the files it takes out of its own graph: what a test mocks.
   *
   * A row is a fact about one file's run and nothing else's, so it is kept
   * beside the records rather than in them — the records say what the text
   * imports, this says what the run never reaches. A file with a row is moved
   * only if some trail from a changed file arrives at it without crossing a
   * file in its row, and what is reached only *through* it goes with it: the
   * component a story declares, the test a setup file's mocks hold for. The
   * graph's own table when absent ({@link Relations.shadows}).
   */
  readonly shadows?: ReadonlyMap<string, readonly string[]>;
}

/**
 * What a set of changed files could have moved.
 *
 * The seed set is the changed files **and every file whose edges are unknown**,
 * which is the rule the whole structure rests on. An unreadable file might import
 * the one that changed; seeding it means everything depending on *it* is observed
 * too, and the cost is a collection rather than a green run over an unwatched
 * surface.
 *
 * One breadth-first search, whatever the number of changed files, over the
 * runtime edges unless the caller names others.
 */
export function movedBy(
  relations: Relations,
  changed: Iterable<string>,
  options: MovedOptions = {},
): Reached {
  const seeds: NodeId[] = [];
  const missing: string[] = [];

  for (const path of changed) {
    const id = idOf(relations, 'file', path);
    if (id === undefined) missing.push(path);
    else seeds.push(id);
  }

  const opaque: Hole[] = [];
  for (let id = 0; id < relations.unknown.length; id += 1) {
    if (relations.unknown[id] !== 1) continue;
    seeds.push(id);

    const because = relations.reasons.get(id);
    opaque.push({ file: relations.names[id]!, ...(because === undefined ? {} : { because }) });
  }

  const reach = unshadowed(relations, seeds, options);
  const files: string[] = [];
  const components: string[] = [];

  for (const id of reach.reached) {
    const node = nodeAt(relations, id);
    if (node === undefined) continue;
    (node.kind === 'file' ? files : components).push(node.name);
  }

  return { files, components, missing: missing.sort(byCodeUnit), opaque, shadowed: reach.shadowed, reach };
}

/**
 * The walk against the arrows with every file left out whose own shadows cut
 * every trail to it, and with nothing reached through such a file.
 *
 * The walk records one parent per node, so it cannot say whether *another*
 * trail avoided the shadows. Asking the other way can: a walk along the arrows
 * from the file, entering none of its shadows, either finds a seed or does not.
 * It runs only for a reached file whose row names a reached node — a mock of
 * something the change never touched cuts nothing, and costs nothing. A file
 * found shadowed is then avoided and the walk repeated, so a component or a
 * file reached only through it is not reached either; the repeat ends when a
 * walk finds no new shadowed file, and a row once decided is not asked again.
 */
function unshadowed(
  relations: Relations,
  seeds: readonly NodeId[],
  options: MovedOptions,
): Reach & { readonly shadowed: readonly string[] } {
  const shadowed: string[] = [];
  const avoid = new Set<NodeId>(options.avoid ?? []);
  const shadows = options.shadows ?? relations.shadows;
  let reach = dependentsOf(relations, seeds, options);
  if (shadows.size === 0) return { ...reach, shadowed };

  const seeded = new Uint8Array(relations.names.length);
  for (const seed of seeds) seeded[seed] = 1;
  const decided = new Set<NodeId>();

  for (;;) {
    let found = 0;
    for (const [name, row] of shadows) {
      const id = idOf(relations, 'file', name);
      if (id === undefined || reach.mask[id] !== 1 || seeded[id] === 1 || decided.has(id)) continue;

      const cut: NodeId[] = [];
      for (const shadow of row) {
        const target = idOf(relations, 'file', shadow);
        if (target !== undefined && reach.mask[target] === 1) cut.push(target);
      }
      if (cut.length === 0) continue;
      decided.add(id);

      const forward = dependenciesOf(relations, [id], { ...options, avoid: cut });
      if (forward.reached.some((node) => seeded[node] === 1)) continue;

      avoid.add(id);
      shadowed.push(name);
      found += 1;
    }
    if (found === 0) break;
    reach = dependentsOf(relations, seeds, { ...options, avoid });
  }

  return { ...reach, shadowed: shadowed.sort(byCodeUnit) };
}

/**
 * How one file or component was reached, as the chain that reached it.
 *
 * The sentence a run prints when somebody asks why a subject was observed. Empty
 * when the node was not reached at all.
 */
export function explain(relations: Relations, moved: Reached, node: Node): readonly string[] {
  const id = idOf(relations, node.kind, node.name);
  if (id === undefined) return [];
  return trailOf(moved.reach, id).map((step) => relations.names[step]!);
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
