/**
 * The walk a moved value takes against the arrows: from the declaring file to
 * each file that loads it, and on from each importer that hands a moved name
 * on, carrying the names it hands on under.
 *
 * What an importer reads and hands on is the caller's question (`reading.ts`);
 * this file only says which importer is asked next, and with which names.
 */

import {
  EDGE_KINDS,
  NODE_KINDS,
  NOTHING,
  RUNTIME_EDGES,
  WHOLE,
  carried,
  type Adjacency,
  type Carry,
  type NodeId,
  type Relations,
} from '@variance-authority/core/relate';

/** Moved names as a file exports them, each to the name it was declared under. */
export type Carried = ReadonlyMap<string, string>;

/**
 * Ask every file that loads `id` at runtime about the names `moved` carries,
 * and every file behind an importer about the names that importer hands on.
 * `visit` reads one importer, by path, and returns the names it hands on.
 *
 * The declaring file is an importer like any other: one that imports itself,
 * or imports a moved name back from a file that hands it on, is asked about
 * it, since its own reading follows only the names it declares.
 *
 * An importer reached again by another path is asked about the names that path
 * carries and no earlier one did, and about nothing when there are none. A name
 * is asked once per importer, since a reader matches an imported name whatever
 * module it came from, and the names asked of a file only grow: the walk ends,
 * and visits each importer at most once per distinct name that reaches it.
 *
 * Every direct importer is asked, whatever names it binds: a caller that counts
 * the tests behind the importers it was shown as explained relies on seeing
 * every edge into `id`.
 *
 * A file that declares it reads another with `/// <depends path>` reads its
 * text, not a name, so it is asked about the whole file, {@link WHOLE}, as is
 * every file behind one that hands the whole file on.
 *
 * A walk costs what it reaches, not the size of the graph: it is called once
 * per changed file, and most reach a handful of importers out of hundreds of
 * thousands of files.
 */
export function walkImporters(
  relations: Relations,
  id: NodeId,
  moved: Carried,
  visit: (importer: string, moved: Carry<string>) => Carry<string>,
): void {
  const { kinds, names, dependents } = relations;
  const mask = idle.get(dependents) ?? new Uint8Array(dependents.offset.length - 1);
  idle.delete(dependents);
  const { entered } = carried<string>(
    dependents,
    [[id, moved]],
    {
      arrive: (importer, _from, kind, carry) => (kinds[importer] !== FILE ? NOTHING : kind === DEPENDS ? WHOLE : carry),
      hand: (importer, arrived) => visit(names[importer]!, arrived),
    },
    { through: RUNTIME_EDGES, seedsHold: false, mask },
  );
  for (const node of entered) mask[node] = 0;
  idle.set(dependents, mask);
}

/**
 * A cleared mask per graph, lent to one walk at a time and cleared behind it
 * over the nodes it entered. A walk that throws keeps its mask, and the next
 * one allocates afresh; a walk inside a visit finds none lent and does too.
 */
const idle = new WeakMap<Adjacency, Uint8Array>();

const FILE = NODE_KINDS.indexOf('file');
const DEPENDS = EDGE_KINDS.indexOf('depends');
