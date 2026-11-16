// compass: variance-authority.reach.crossings
/**
 * A test's file and the modules it entered, as nodes of the import graph:
 * the names a file is held under, the edge kinds a run loads through, and the
 * hops from the test to each module it entered. {@link distanceFromView} and
 * `coverage --at-distance` both walk from here.
 */

import { EDGE_KINDS, RUNTIME_EDGES, idOf, type NodeId, type Relations } from '@variance-authority/core/relate';
import type { DistanceOptions } from './distance.js';

/** A file held under its own path alone, when no `knownAs` names more. */
export const ownName = (file: string): readonly string[] => [file];

/**
 * Import hops from a test's file to every module it entered, walked over the
 * modules it entered alone — the walk {@link distanceFromView} measures a
 * change by, read for every module at once. A module the walk could not reach
 * from the test's file is absent, never far: the graph has no executed path to
 * it, which says nothing of how far it is. The test's own file is 0.
 *
 * Breadth-first over the entered nodes only, so a test costs the imports of
 * what it entered and never the size of the graph: `coverage --at-distance`
 * walks once per test file.
 */
export function hopsFromTest(
  test: string,
  entered: ReadonlySet<string>,
  options: DistanceOptions,
): ReadonlyMap<string, number> | { readonly because: string } {
  const { relations } = options;
  if (relations === undefined) return { because: 'no import graph was supplied' };
  const nodes = nodesOf(relations, options.knownAs ?? ownName);
  const start = nodes(test);
  if (start.length === 0) return { because: `the graph does not hold ${test}` };
  const open = new Set<NodeId>(start);
  for (const file of entered) for (const id of nodes(file)) open.add(id);
  const depth = new Map<NodeId, number>(start.map((id) => [id, 0]));
  const { offset, target, kind } = relations.depends;
  for (let queue = [...start], next: NodeId[] = [], hop = 1; queue.length > 0; queue = next, next = [], hop += 1) {
    for (const from of queue) {
      for (let edge = offset[from]!; edge < offset[from + 1]!; edge += 1) {
        const to = target[edge]!;
        if (!RUNTIME_KINDS[kind[edge]!] || !open.has(to) || depth.has(to)) continue;
        depth.set(to, hop);
        next.push(to);
      }
    }
  }
  const hops = new Map<string, number>();
  for (const file of entered) {
    for (const id of nodes(file)) {
      const length = depth.get(id);
      if (length !== undefined && length < (hops.get(file) ?? Infinity)) hops.set(file, length);
    }
  }
  return hops;
}

/** Whether each edge kind, by its index, is one a run loads through. */
export const RUNTIME_KINDS = EDGE_KINDS.map((one) => RUNTIME_EDGES.includes(one));

/**
 * Every node one file is held under. Every name, not the first one that
 * resolves: one module can be two nodes — a workspace package is imported
 * through its manifest, so an importer's edge lands on `dist` while the
 * snapshot recorded `src`, and picking either one leaves the other cut out of
 * the graph at exactly the hop that mattered. `knownAs` is documented as every
 * name a file is held under; honouring one of them would make that sentence
 * false.
 */
export function nodesOf(relations: Relations, knownAs: (file: string) => readonly string[]): (file: string) => readonly NodeId[] {
  return (file) => {
    const found: NodeId[] = [];
    for (const name of knownAs(file)) {
      const id = idOf(relations, 'file', name);
      if (id !== undefined) found.push(id);
    }
    return found;
  };
}
