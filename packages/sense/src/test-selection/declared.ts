/**
 * The files a `/// <depends path>` names whose run loads a given file.
 *
 * A declaration says its declarer runs the named file, in a process the record
 * may never see: a script a test spawns, a program it starts. What that run
 * loads, at any depth, is the declarer's as much as the named file is, and no
 * row can say otherwise, because the run the declaration describes left none.
 * So a changed file in the runtime closure of a declared file charges that
 * file's declarers, however the change is answered otherwise.
 */

import { EDGE_KINDS, RUNTIME_EDGES, dependenciesOf, idOf, type NodeId, type Relations } from '@variance-authority/core/relate';

const DEPENDS = EDGE_KINDS.indexOf('depends');

// One inversion per graph: each node, the declared files whose closure holds it.
const behindOf = new WeakMap<Relations, ReadonlyMap<NodeId, readonly NodeId[]>>();

/** The declared files whose runtime closure holds `id`, itself included when it is declared. */
export function declaredBehind(relations: Relations, id: NodeId): readonly NodeId[] {
  let behind = behindOf.get(relations);
  if (behind === undefined) {
    behind = invert(relations);
    behindOf.set(relations, behind);
  }
  return behind.get(id) ?? [];
}

/** The names of the declared files whose runtime closure holds any of these files. */
export function declaredBehindFiles(relations: Relations | undefined, files: Iterable<string>): readonly string[] {
  if (relations === undefined) return [];
  const targets = new Set<NodeId>();
  for (const file of files) {
    const id = idOf(relations, 'file', file);
    if (id !== undefined) for (const target of declaredBehind(relations, id)) targets.add(target);
  }
  return [...targets].sort((a, b) => a - b).map((target) => relations.names[target]!);
}

function invert(relations: Relations): ReadonlyMap<NodeId, readonly NodeId[]> {
  const { offset, kind } = relations.dependents;
  const behind = new Map<NodeId, NodeId[]>();
  for (let target = 0; target < relations.names.length; target += 1) {
    let declared = false;
    for (let edge = offset[target]!; edge < offset[target + 1]! && !declared; edge += 1) declared = kind[edge] === DEPENDS;
    if (!declared) continue;
    for (const node of dependenciesOf(relations, [target], { through: RUNTIME_EDGES }).nodes) {
      const targets = behind.get(node);
      if (targets === undefined) behind.set(node, [target]);
      else targets.push(target);
    }
  }
  return behind;
}
