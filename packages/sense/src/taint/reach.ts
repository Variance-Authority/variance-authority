/**
 * How far a file's run is from each module it shadows.
 *
 * A shadow says the file's run never reaches a module; the graph says whether
 * the run would have reached it at all. A mock of a module nothing the test
 * file imports loads, directly or through what it imports, replaces nothing:
 * it is a line left over from code that moved. One many imports away replaces
 * an internal of code the test file never names, and ties the test to it.
 *
 * The distance is the shortest one along the edges a runtime evaluates — a
 * type-only import loads nothing — and the walk passes through the file's
 * other shadows: a mock written without a factory still evaluates the real
 * module to learn its shape, and loads what that module imports.
 */

// compass: variance-authority.reach

import { dependenciesOf, idOf, nodeAt, trailOf, type Relations } from '@variance-authority/core/relate';

/** One module a file shadows, and how far the file's run is from it. */
export interface ShadowReach {
  readonly module: string;
  /** Imports from the file to the module, along the shortest trail. Absent when the file does not load it. */
  readonly hops?: number;
  /** The file whose import is the last step of that trail. Present exactly when `hops` is. */
  readonly importer?: string;
}

/** Every module `file` shadows in `relations`, sorted, with its distance from the file. */
export function shadowReach(relations: Relations, file: string): readonly ShadowReach[] {
  const shadowed = relations.shadows.get(file) ?? [];
  const seed = idOf(relations, 'file', file);
  if (shadowed.length === 0 || seed === undefined) return [];
  const walk = dependenciesOf(relations, [seed]);

  return [...shadowed].sort(byCodeUnit).map((module) => {
    const id = idOf(relations, 'file', module);
    const trail = id === undefined ? [] : trailOf(walk, id);
    if (trail.length < 2) return { module };
    return { module, hops: trail.length - 1, importer: nodeAt(relations, trail.at(-2)!)!.name };
  });
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
