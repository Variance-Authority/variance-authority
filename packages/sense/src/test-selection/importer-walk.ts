/**
 * The walk a moved value takes against the arrows: from the declaring file to
 * each file that loads it, and on from each importer that hands a moved name
 * on, carrying the names it hands on under.
 *
 * What an importer reads and hands on is the caller's question (`reading.ts`);
 * this file only says which importer is asked next, and with which names.
 */

import { NODE_KINDS, NOTHING, carried, type NodeId, type Relations } from '@variance-authority/core/relate';

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
 */
export function walkImporters(
  relations: Relations,
  id: NodeId,
  moved: Carried,
  visit: (importer: string, moved: Carried) => Carried,
): void {
  const { kinds, names } = relations;
  carried<string>(
    relations.dependents,
    [[id, moved]],
    {
      arrive: (importer, _from, _kind, carry) => (kinds[importer] === FILE ? carry : NOTHING),
      // Only names reach an importer: nothing on this walk carries the whole file.
      hand: (importer, arrived) => visit(names[importer]!, arrived as Carried),
    },
    { seedsHold: false },
  );
}

const FILE = NODE_KINDS.indexOf('file');
