// compass: variance-authority.reach
/**
 * What a change to the install did to the repository's own files.
 *
 * The far-right end of the line selection walks. A bumped package and a moved
 * manifest change how files load without changing a line of any of them, and
 * every later stage of a selection asks about files: whether one sits before
 * reach, whether the record measured it, which tests entered it. So the install
 * is read back into files once, here, and nothing after this stage hears of a
 * package.
 *
 * ## Where a bump stops
 *
 * Against the arrows through the install, then one step into the repository. A
 * bump of `jsdom` reaches `jest-environment-jsdom`, which rests on it, and from
 * there the setup file that imports that: the first file whose import loads the
 * changed code. It stops there because everything further along loads the
 * package through that file, so a test that entered anything further along
 * evaluated it on the way, and the stages after this one answer for its
 * importers as they do for any changed file's.
 *
 * Runtime edges only. `import type { Theme } from '@mui/material'` is erased
 * before anything runs, so a bump of `@mui/material` reaches nothing through it.
 *
 * ## Absence
 *
 * A package the graph holds no node for is imported by nothing here, and it
 * reaches nothing. That is an answer rather than a gap: every file that names a
 * package has an edge to it.
 */

import { EDGE_KINDS, RUNTIME_EDGES, idOf, nodeAt, nodesOfKind, type NodeId, type Relations } from './graph.js';
import { within } from './before.js';
import { dependentsOf, trailOf } from './reach.js';

/** What the install comparison says moved, by name. */
export interface InstallMoved {
  /** Packages whose installed version moved. */
  readonly packages: readonly string[];
  /** Manifests whose `exports`, `main` or `type` moved, as repository paths. */
  readonly moved: readonly string[];
}

/** The install, read as files. */
export interface BeyondReach {
  /** Every repository file a bump or a moved manifest changed, whole, sorted. */
  readonly files: readonly string[];
  /**
   * Moved manifests the graph holds no file beside: a gap under the scanned
   * roots, or a package outside them. Each is read as the ordinary changed path
   * it would have been, rather than as a package that reached nothing.
   */
  readonly unplaced: readonly string[];
  /** The bumped packages that changed a file, for the sentence that says what the answer was built from. */
  readonly traced: readonly string[];
  /**
   * For each file a bump reached, the packages it was reached through, from the
   * bumped one to the one the file imports: `['jsdom', 'jest-environment-jsdom']`.
   * The first bump to reach a file names it.
   */
  readonly chains: ReadonlyMap<string, readonly string[]>;
}

/** The edge kinds a file loads a package through, as a byte lookup over `EDGE_KINDS`. */
const IMPORTS = new Uint8Array(EDGE_KINDS.length);
for (const kind of RUNTIME_EDGES) if (kind !== 'depends-on') IMPORTS[EDGE_KINDS.indexOf(kind)] = 1;

/** Trace the install's moves to the repository files they change. */
export function beyondReach(relations: Relations, install: InstallMoved): BeyondReach {
  const files = new Set<string>();

  const traced: string[] = [];
  const chains = new Map<string, readonly string[]>();
  for (const name of install.packages) {
    const id = idOf(relations, 'package', name);
    if (id === undefined) continue;
    // Every package whose install rests on this one, itself included.
    const traversal = dependentsOf(relations, [id], { through: ['depends-on'] });
    let reached = false;
    for (const at of traversal.nodes) {
      for (const importer of importersOf(relations, at)) {
        const file = relations.names[importer]!;
        files.add(file);
        if (!chains.has(file)) chains.set(file, trailOf(traversal, at).map((step) => relations.names[step]!));
        reached = true;
      }
    }
    if (reached) traced.push(name);
  }

  // A moved manifest's directory is expanded the way a monorepo tool's changed
  // directory is: every file the graph holds under it.
  const unplaced: string[] = [];
  if (install.moved.length > 0) {
    const names = nodesOfKind(relations, 'file').map((id) => relations.names[id]!);
    for (const manifest of install.moved) {
      const beside = names.filter((file) => within(file, [directoryOf(manifest)]));
      if (beside.length === 0) unplaced.push(manifest);
      for (const file of beside) files.add(file);
    }
  }

  return { files: [...files].sort(byCodeUnit), unplaced, traced, chains };
}

/** The files with a runtime import of `id`, one step against the arrows. */
function importersOf(relations: Relations, id: NodeId): readonly NodeId[] {
  const { offset, kind, target } = relations.dependents;
  const importers: NodeId[] = [];
  for (let at = offset[id]!; at < offset[id + 1]!; at += 1) {
    if (IMPORTS[kind[at]!] !== 1) continue;
    const other = target[at]!;
    if (nodeAt(relations, other)?.kind === 'file') importers.push(other);
  }
  return importers;
}

function directoryOf(file: string): string {
  const at = file.lastIndexOf('/');
  return at === -1 ? '.' : file.slice(0, at);
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
