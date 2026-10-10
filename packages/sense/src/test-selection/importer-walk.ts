/**
 * The walk a moved value takes against the arrows: from the declaring file to
 * each file that loads it, and on from each importer that hands a moved name
 * on, carrying the names it hands on under.
 *
 * What an importer reads and hands on is the caller's question (`reading.ts`);
 * this file only says which importer is asked next, and with which names.
 */

import { EDGE_KINDS, RUNTIME_EDGES, nodeAt, type NodeId, type Relations } from '@variance-authority/core/relate';

/** Moved names as a file exports them, each to the name it was declared under. */
export type Carried = ReadonlyMap<string, string>;

/**
 * Ask every file that loads `id` at runtime about the names `moved` carries,
 * and every file behind an importer about the names that importer hands on.
 * `visit` reads one importer, by path, and returns the names it hands on.
 *
 * An importer reached again by another path is asked about the names that path
 * carries and no earlier one did, and about nothing when there are none. A name
 * is asked once per importer, since a reader matches an imported name whatever
 * module it came from, and the names asked of a file only grow: the walk ends,
 * and visits each importer at most once per distinct name that reaches it.
 */
export function walkImporters(
  relations: Relations,
  id: NodeId,
  moved: Carried,
  visit: (importer: string, moved: Carried) => Carried,
): void {
  const asked = new Map<NodeId, Set<string>>([[id, new Set(moved.keys())]]);
  let wave: Array<{ readonly id: NodeId; readonly moved: Carried }> = [{ id, moved }];
  while (wave.length > 0) {
    const next: typeof wave = [];
    for (const step of wave) {
      for (const importer of directImporters(relations, step.id)) {
        const node = nodeAt(relations, importer);
        if (node === undefined || node.kind !== 'file') continue;
        const unasked = unaskedAt(asked, importer, step.moved);
        if (unasked.size === 0) continue;
        const passed = visit(node.name, unasked);
        if (passed.size > 0) next.push({ id: importer, moved: passed });
      }
    }
    wave = next;
  }
}

/** The names of `moved` not yet asked of `importer`, marked asked as they are returned. */
function unaskedAt(asked: Map<NodeId, Set<string>>, importer: NodeId, moved: Carried): Carried {
  let done = asked.get(importer);
  if (done === undefined) asked.set(importer, (done = new Set()));
  const unasked = new Map<string, string>();
  for (const [name, origin] of moved) {
    if (done.has(name)) continue;
    done.add(name);
    unasked.set(name, origin);
  }
  return unasked;
}

/** The files that load this one at runtime, one edge away: a type-only import loads nothing. */
function directImporters(relations: Relations, id: NodeId): readonly NodeId[] {
  const { offset, target, kind } = relations.dependents;
  const importers: NodeId[] = [];
  for (let edge = offset[id]!; edge < offset[id + 1]!; edge += 1) {
    if (LOADS[kind[edge]!] === 1 && target[edge] !== id) importers.push(target[edge]!);
  }
  return importers;
}

const LOADS = new Uint8Array(EDGE_KINDS.length);
for (const kind of RUNTIME_EDGES) LOADS[EDGE_KINDS.indexOf(kind)] = 1;
