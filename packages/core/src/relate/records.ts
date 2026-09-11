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
import { dependentsOf, trailOf, type Reach, type ReachOptions } from './reach.js';

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
export function relationsOfFiles(records: Iterable<FileRecord>): Relations {
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

  return relationsOf({ relations, isolated, unknown });
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

  /** The traversal, kept so a caller can ask how any one file was reached. */
  readonly reach: Reach;
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
  options: ReachOptions = {},
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

  const reach = dependentsOf(relations, seeds, options);
  const files: string[] = [];
  const components: string[] = [];

  for (const id of reach.reached) {
    const node = nodeAt(relations, id);
    if (node === undefined) continue;
    (node.kind === 'file' ? files : components).push(node.name);
  }

  return { files, components, missing: missing.sort(byCodeUnit), opaque, reach };
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
