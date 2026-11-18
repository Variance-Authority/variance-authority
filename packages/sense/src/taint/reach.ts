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
 *
 * A file whose imports nobody could read — a parse failure, a specifier that
 * is not a literal — may load anything, so a module the walk does not reach
 * past one is not known to be unloaded: the entry names that file instead.
 */

// compass: variance-authority.reach

import { RUNTIME_EDGES, dependenciesOf, idOf, nodeAt, trailOf, type Relations } from '@variance-authority/core/relate';
import { codeUnitOrder } from '@variance-authority/core/segment';

/** One module a file shadows, and how far the file's run is from it. */
export interface ShadowReach {
  readonly module: string;
  /** Imports from the file to the module, along the shortest trail. Absent when the file does not load it. */
  readonly hops?: number;
  /** The file whose import is the last step of that trail. Present exactly when `hops` is. */
  readonly importer?: string;
  /**
   * A loaded file whose imports could not be read, present only when `hops` is
   * absent: the module may load through it, so the file is not known not to load it.
   */
  readonly unread?: string;
}

/** Every module `file` shadows in `relations`, sorted, with its distance from the file. */
export function shadowReach(relations: Relations, file: string): readonly ShadowReach[] {
  const shadowed = 'native' in relations ? relations.native.shadows([file])[0] ?? [] : relations.shadows.get(file) ?? [];
  const seed = idOf(relations, 'file', file);
  if (shadowed.length === 0 || seed === undefined) return [];
  const walk = dependenciesOf(relations, [seed], { through: RUNTIME_EDGES });
  const blind = walk.nodes.find((id) => 'native' in relations ? walk.info?.get(id)?.unknown !== undefined : relations.unknown[id] === 1);
  const unread = blind === undefined ? undefined : walk.info?.get(blind)?.name ?? nodeAt(relations, blind)!.name;

  const known = 'native' in relations ? new Map(relations.native.lookup(shadowed.map((name) => ({kind:'file',name}))).flatMap((node) => node === null ? [] : [[node.name,node.id] as const])) : undefined;
  return [...shadowed].sort(codeUnitOrder).map((module) => {
    const id = known === undefined ? idOf(relations, 'file', module) : known.get(module);
    const trail = id === undefined ? [] : trailOf(walk, id);
    if (trail.length < 2) return unread === undefined ? { module } : { module, unread };
    return { module, hops: trail.length - 1, importer: walk.info?.get(trail.at(-2)!)?.name ?? nodeAt(relations, trail.at(-2)!)!.name };
  });
}
