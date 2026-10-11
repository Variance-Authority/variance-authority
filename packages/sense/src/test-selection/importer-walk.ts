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
 */
export function walkImporters(
  relations: Relations,
  id: NodeId,
  moved: Carried,
  visit: (importer: string, moved: Carried) => Carried,
): void {
  const visited = new Set<NodeId>([id]);
  let wave: Array<{ readonly id: NodeId; readonly moved: Carried }> = [{ id, moved }];
  while (wave.length > 0) {
    const next: typeof wave = [];
    for (const step of wave) {
      for (const importer of directImporters(relations, step.id)) {
        const node = nodeAt(relations, importer);
        if (node === undefined || node.kind !== 'file' || visited.has(importer)) continue;
        visited.add(importer);
        const passed = visit(node.name, step.moved);
        if (passed.size > 0) next.push({ id: importer, moved: passed });
      }
    }
    wave = next;
  }
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
