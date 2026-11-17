/** Batch only the nodes or edge rows a caller currently needs. */
// compass: variance-authority.reach.relations
import { EDGE_KINDS, NODE_KINDS, idOf, type Node, type NodeId, type Relations } from './graph.js';
import type { RelationNode, RelationRow } from './questions.js';

export function lookupNodes(relations: Relations, nodes: readonly Node[]): readonly (RelationNode | null)[] {
  if ('native' in relations) return relations.native.lookup(nodes);
  return nodes.map((node) => {
    const id = idOf(relations, node.kind, node.name);
    return id === undefined ? null : describeNodes(relations, [id])[0]!;
  });
}
export function describeNodes(relations: Relations, ids: readonly NodeId[]): readonly (RelationNode | null)[] {
  if ('native' in relations) return relations.native.nodes(ids);
  return ids.map((id) => relations.names[id] === undefined ? null : {
    id, name: relations.names[id]!, kind: NODE_KINDS[relations.kinds[id]!]!,
    ...(relations.reasons.get(id) === undefined ? {} : { unknown: relations.reasons.get(id)! }),
  });
}
export function relationRows(relations: Relations, ids: readonly NodeId[], reverse = false): readonly RelationRow[] {
  if ('native' in relations) return relations.native.rows(ids, reverse);
  const { offset, target, kind } = reverse ? relations.dependents : relations.depends;
  return ids.map((id) => {
    const edges: RelationRow['edges'][number][] = [];
    for (let at = offset[id]!; at < offset[id + 1]!; at += 1) {
      const to = describeNodes(relations, [target[at]!])[0];
      if (to !== null && to !== undefined) edges.push({ to, kind: EDGE_KINDS[kind[at]!]! });
    }
    return { id, edges };
  });
}
