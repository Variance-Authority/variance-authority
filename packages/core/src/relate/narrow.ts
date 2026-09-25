/**
 * The walk against the arrows, narrowed by the names each importer uses.
 *
 * A file-graph edge says *this file imports that one*, and a plain walk charges
 * every importer for every change. An importer reaches a module only through
 * the names it binds, though, so a change that moved `total` and left `label`
 * alone reaches the files that import `total` and not the ones that import
 * `label`. That is tree shaking, asked of reach instead of a bundle.
 *
 * Each visited file carries one of two states:
 *
 * - **whole** — what it does as it loads moved, or nobody said which of its
 *   exports did. Every dependent is entered, as the plain walk does.
 * - **the exports that moved** — read from the file's two texts for a seed,
 *   or carried through a re-export for a barrel. A dependent that imports one
 *   of them is entered whole: which of *its* exports read the name is a
 *   question about its body, and nothing here reads one. A dependent that
 *   re-exports one is entered carrying the names it republishes them under.
 *
 * Every answer the use cannot give is whole: an edge the lookup does not
 * know, a namespace import, a `require`, an `import()`, a stylesheet, a
 * component declared in the file. A narrower walk has to be earned by a name
 * the parse recorded, so an unknown can only cost a wider one.
 *
 * A file's names only grow, and a file that grew is expanded again, so the walk
 * reaches the same fixpoint whatever order the seeds arrive in.
 */

import { EDGE_KINDS, type Adjacency, type NodeId } from './graph.js';
import type { Traversal } from './reach.js';

/** How one file uses one file it imports, read from the parse that recorded the edge. */
export interface EdgeUse {
  /**
   * The names an `import` binds from the target, `default` for a default
   * import. Absent when the use is the whole module: a namespace, a `require`,
   * an `import` that binds nothing, which a `require` is stored as.
   */
  readonly imports?: readonly string[];
  /**
   * What a re-export republishes, as `[the target's name, this file's name]`.
   * `['*', '*']` is `export * from`, which republishes every name but
   * `default`; `['*', 'ns']` is `export * as ns from`. Absent when the parse
   * did not record what the file publishes.
   */
  readonly reexports?: readonly (readonly [string, string])[];
}

/** How `importer` uses `target`, both by file path; `undefined` is whole. */
export type Uses = (importer: string, target: string) => EdgeUse | undefined;

const IMPORTS = EDGE_KINDS.indexOf('imports');
const REEXPORTS = EDGE_KINDS.indexOf('reexports');

/** What a re-export hands on from `moved`, under the names the importer publishes. */
function republished(passes: readonly (readonly [string, string])[], moved: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const [imported, exported] of passes) {
    if (imported === '*' && exported === '*') {
      for (const name of moved) if (name !== 'default') out.push(name);
    } else if (imported === '*' || moved.has(imported)) {
      out.push(exported);
    }
  }
  return out;
}

/**
 * Breadth-first against the arrows from `seeds`, each seed in `moved` carrying
 * the exports its change moved and every other one whole.
 */
export function narrowed(
  dependents: Adjacency,
  names: readonly string[],
  seeds: Iterable<NodeId>,
  moved: ReadonlyMap<NodeId, readonly string[]>,
  uses: Uses,
  allowed: Uint8Array,
  avoid: Iterable<NodeId> = [],
): Traversal {
  const nodes = names.length;
  const mask = new Uint8Array(nodes);
  const via = new Int32Array(nodes).fill(-1);
  const avoided = new Uint8Array(nodes);
  for (const id of avoid) if (id >= 0 && id < nodes) avoided[id] = 1;

  // A visited node absent here is whole.
  const partial = new Map<NodeId, Set<string>>();
  const queue: NodeId[] = [];

  const enter = (next: NodeId, from: NodeId, exports?: readonly string[]): void => {
    if (avoided[next] === 1) return;
    if (mask[next] !== 1) {
      mask[next] = 1;
      via[next] = from;
      if (exports !== undefined) partial.set(next, new Set(exports));
      queue.push(next);
      return;
    }
    const held = partial.get(next);
    if (held === undefined) return;
    if (exports === undefined) {
      partial.delete(next);
      queue.push(next);
      return;
    }
    const size = held.size;
    for (const name of exports) held.add(name);
    if (held.size > size) queue.push(next);
  };

  for (const seed of seeds) {
    if (seed < 0 || seed >= nodes || mask[seed] === 1 || avoided[seed] === 1) continue;
    enter(seed, -1, moved.get(seed));
  }

  for (let head = 0; head < queue.length; head += 1) {
    const node = queue[head]!;
    const held = partial.get(node);
    if (held?.size === 0) continue;
    const end = dependents.offset[node + 1]!;

    for (let at = dependents.offset[node]!; at < end; at += 1) {
      const kind = dependents.kind[at]!;
      if (allowed[kind] !== 1) continue;
      const next = dependents.target[at]!;
      if (held === undefined || (kind !== IMPORTS && kind !== REEXPORTS)) {
        enter(next, node);
        continue;
      }

      const use = uses(names[next]!, names[node]!);
      if (kind === IMPORTS) {
        const imported = use?.imports;
        // TODO: enter the importer carrying the exports whose bodies read the
        // name, which needs the addon's per-export reach within the importer;
        // until then an import hop two out is charged whole.
        if (imported === undefined || imported.some((name) => held.has(name))) enter(next, node);
      } else if (use?.reexports === undefined) {
        enter(next, node);
      } else {
        const out = republished(use.reexports, held);
        if (out.length > 0) enter(next, node, out);
      }
    }
  }

  // In id order, so a report built from it is byte-stable whatever order the
  // caller listed its changed files in.
  const visited: NodeId[] = [];
  for (let id = 0; id < nodes; id += 1) if (mask[id] === 1) visited.push(id);

  return { mask, via, nodes: visited };
}
