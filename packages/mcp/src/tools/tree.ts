import {
  EDGE_KINDS,
  dependenciesOf,
  dependentsOf,
  idOf,
  nodeAt,
  nodesOfKind,
  relationsOfFiles,
  type FileRecord,
  type NodeId,
  type Relations,
} from '@variance-authority/core/relate';
import { relative } from 'node:path';
import { costsFrom } from './hops.js';

/**
 * The source tree, as the one thing allowed to say whether a path exists.
 *
 * A start point is a coordinate, and a coordinate is a fact about a tree. The
 * run's notes are not a tree: they say which files were *seen rendering*, which
 * is a similar-looking different question and answers wrongly in both
 * directions — every real file the run never rendered reads as *not found*, and
 * a path the run happened to write down reads as *found* whether or not
 * anything is there.
 *
 * So the authority is the scanner, and nothing else. It is a machine and works
 * one way: it walks the tree, it holds what it found, and it holds the arrows
 * between them. It cannot invent a file, it cannot invent an import, and it
 * cannot answer *maybe*.
 *
 * ## Two questions, and only two
 *
 * **Does this path exist?** — answered against {@link Tree.files}, which is
 * every coordinate the scan has, compared whole.
 *
 * **What is reachable from it?** — answered by walking the import graph one
 * way, from the files the path selected along their arrows, at any depth. What
 * those files rest on is reachable from them. What rests on *them* is not: an
 * import is a one-way arrow, and a file does not become part of a start point's
 * neighbourhood by naming it. No depth bound, because a bound would make the
 * answer a lower bound and a lower bound loses files that genuinely are
 * reachable.
 *
 * The other direction is not missing, it is somewhere else. A subject is in
 * scope when a file in scope produced it, and the run's own record of what each
 * subject rendered carries the answer upward — a leaf in scope brings in every
 * subject recorded as having rendered it, which no import arrow could say.
 *
 * Every edge kind is walked, `type` included. The default traversal leaves type
 * imports out because nothing behind one can *run* — but a reader asking where
 * something lives is asking about source, and a type a component imports is a
 * file in its neighbourhood by any reading a person would recognise.
 */

/** The scanned tree, and the two questions a start point asks of it. */
export interface Tree {
  /** The repository the coordinates are relative to. */
  readonly root: string;
  /** Every file the scan holds a coordinate for, repo-relative, forward slashes. */
  readonly files: ReadonlySet<string>;
  /**
   * Every file reachable from these along the imports, at any depth. The seeds
   * themselves are in it. Seeds the tree does not hold reach nothing and
   * contribute nothing.
   */
  reachedFrom(seeds: Iterable<string>): ReadonlySet<string>;
  /**
   * Every file that reaches these along the imports, at any depth. The same
   * walk against the arrows, under the same rules.
   */
  reaching(seeds: Iterable<string>): ReadonlySet<string>;
  /**
   * Minimum import distance from the seeds to every reachable file.
   *
   * A seed is at zero and every arrow adds one. This is deliberately not the
   * weighted hop cost below: distance is a quantity a caller can check by
   * counting imports, while cost is a ranking signal.
   */
  distanceFrom(seeds: Iterable<string>): ReadonlyMap<string, number>;
  /** The same minimum distance against the arrows. */
  distanceTo(seeds: Iterable<string>): ReadonlyMap<string, number>;
  /**
   * Files whose imports could not be enumerated — an unreadable file, a
   * specifier nothing resolved.
   *
   * What lies behind one of these is not knowable from the graph, so a scope
   * holding one is not a proof about the files it leaves out. It is counted and
   * said rather than widened over: every file that imports an unknown one is
   * 209 of the 1,574 files in this repository, which is a number no start point
   * could survive being unioned with.
   */
  unknownAmong(files: Iterable<string>): readonly string[];
  /**
   * How far in each reachable file is, in half-hops, along the arrows.
   *
   * Recorded beside the closure and used by nothing. What it costs to get
   * somewhere is not what decides whether it is in scope — the closure is whole
   * or it is nothing — and this is a column to measure a ranking against before
   * a ranking is changed by it. See `./hops.js`.
   */
  hopsFrom(seeds: Iterable<string>): ReadonlyMap<string, number>;
  /** The same quantity against the arrows, for the `to` direction. */
  hopsTo(seeds: Iterable<string>): ReadonlyMap<string, number>;
}

/**
 * The tree a pile of scanned records makes.
 *
 * Pure, and separate from the scan on purpose: the rule about paths is decided
 * here and can be tested with a handful of records, without a repository on
 * disk and without the parser.
 */
export function treeOf(
  records: Iterable<FileRecord>,
  root = '.',
  /**
   * Directories a manifest governs, for the out-of-package hop.
   *
   * Supplied rather than guessed: `packages/` and `apps/` are two repositories'
   * conventions and neither is a fact. With none given the out-of-package bucket
   * never fires for workspace code, which is the right answer for a repository
   * that is one package. `node_modules` is read off the path regardless.
   */
  packages: readonly string[] = [],
): Tree {
  const relations = relationsOfFiles(records);
  return treeFromRelations(relations, root, packages);
}

/** Build the path-query surface from an already folded source graph. */
export function treeFromRelations(
  relations: Relations,
  root = '.',
  packages: readonly string[] = [],
): Tree {
  const files = new Set<string>();
  for (const id of nodesOfKind(relations, 'file')) files.add(relations.names[id]!);

  return {
    root,
    files,
    reachedFrom: (seeds) => walk(relations, seeds, dependenciesOf),
    reaching: (seeds) => walk(relations, seeds, dependentsOf),
    distanceFrom: (seeds) => distances(relations, seeds, dependenciesOf),
    distanceTo: (seeds) => distances(relations, seeds, dependentsOf),
    unknownAmong: (among) => unknownAmong(relations, among),
    hopsFrom: (seeds) => costsFrom(relations, idsOf(relations, seeds), relations.depends, packages),
    hopsTo: (seeds) => costsFrom(relations, idsOf(relations, seeds), relations.dependents, packages, true),
  };
}

/** Accept coordinates relative to a workspace nested below the graph root. */
export function treeAtWorkspace(tree: Tree, workspace: string): Tree {
  const prefix = relative(tree.root, workspace).replaceAll('\\', '/');
  if (prefix === '' || prefix.startsWith('..')) return tree;
  const fromWorkspace = `${prefix}/`;
  const actual = new Map<string, string>();
  for (const file of tree.files) {
    if (file.startsWith(fromWorkspace)) actual.set(file.slice(fromWorkspace.length), file);
  }
  const seeds = (values: Iterable<string>): Iterable<string> =>
    [...values].map((value) => actual.get(value) ?? value);
  return {
    root: workspace,
    files: new Set(actual.keys()),
    reachedFrom: (values) => tree.reachedFrom(seeds(values)),
    reaching: (values) => tree.reaching(seeds(values)),
    distanceFrom: (values) => tree.distanceFrom(seeds(values)),
    distanceTo: (values) => tree.distanceTo(seeds(values)),
    unknownAmong: (values) => tree.unknownAmong(values),
    hopsFrom: (values) => tree.hopsFrom(seeds(values)),
    hopsTo: (values) => tree.hopsTo(seeds(values)),
  };
}

/** Minimum edge count to every reached file, recovered from the BFS forest. */
function distances(
  relations: Relations,
  seeds: Iterable<string>,
  direction: Direction,
): ReadonlyMap<string, number> {
  const traversal = direction(relations, idsOf(relations, seeds), { through: EDGE_KINDS });
  const depths = new Int32Array(relations.names.length).fill(-1);
  const found = new Map<string, number>();

  for (const id of traversal.nodes) {
    if (depths[id] === -1) {
      const pending: NodeId[] = [];
      let at: NodeId = id;
      while (depths[at] === -1 && traversal.via[at] !== -1) {
        pending.push(at);
        at = traversal.via[at]!;
      }

      let depth = depths[at]!;
      if (depth === -1) {
        depth = 0;
        depths[at] = depth;
      }
      while (pending.length > 0) {
        const next = pending.pop()!;
        depth += 1;
        depths[next] = depth;
      }
    }

    if (nodeAt(relations, id)?.kind === 'file') found.set(relations.names[id]!, depths[id]!);
  }

  return found;
}

function idsOf(relations: Relations, seeds: Iterable<string>): readonly NodeId[] {
  const ids: NodeId[] = [];
  for (const seed of seeds) {
    const id = idOf(relations, 'file', seed);
    if (id !== undefined) ids.push(id);
  }
  return ids;
}

/** One direction of the walk. Both directions are the same code and one call. */
type Direction = typeof dependenciesOf;

function walk(relations: Relations, seeds: Iterable<string>, direction: Direction): ReadonlySet<string> {
  const ids = idsOf(relations, seeds);
  const found = new Set<string>();
  if (ids.length === 0) return found;

  // One breadth-first search over the whole seed set, not one per seed: a
  // search from many sources costs what a search from one costs.
  const traversal = direction(relations, ids, { through: EDGE_KINDS });
  for (const id of traversal.nodes) {
    // A component is a name, and a name is not a place. It arrives here
    // because the graph carries the component that declares a file as a node
    // of its own, and it leaves here for the same reason a component never
    // resolved a path in the first place.
    if (nodeAt(relations, id)?.kind === 'file') found.add(relations.names[id]!);
  }
  return found;
}

function unknownAmong(relations: Relations, among: Iterable<string>): readonly string[] {
  const found: string[] = [];
  for (const file of among) {
    const id = idOf(relations, 'file', file);
    if (id !== undefined && relations.unknown[id] === 1) found.push(file);
  }
  return found.sort();
}

/** What a scan needs to be told, beyond where the repository is. */
export interface TreeOptions {
  /** The repository root. Every coordinate comes back relative to it. */
  readonly root: string;
  /**
   * Where to start walking, relative to the root. The whole repository when
   * absent, because a start point may name any path in it and a narrower walk
   * would answer *not found* about a file that is plainly there.
   */
  readonly dirs?: readonly string[];
  /**
   * The persistent scan index, when the caller keeps one.
   *
   * The same file a run's own scan uses, so a reader asking a question after a
   * run pays a map lookup per unchanged file rather than a parse.
   */
  readonly index?: string;
}

/**
 * Read the tree.
 *
 * The scanner is imported dynamically and its absence is stated rather than
 * absorbed. Every other optional dependency here degrades in cost; this one
 * decides an answer, and a start point resolved against something that is not
 * the tree is the defect this module exists to remove.
 */
export async function readTree(options: TreeOptions): Promise<Tree> {
  let scanner: typeof import('@variance-authority/sense');
  try {
    scanner = await import('@variance-authority/sense');
  } catch (error) {
    throw new Error(
      'a start point is a path in the source tree, and the scanner that reads the tree could ' +
        `not be loaded: ${messageOf(error)}. Install \`@variance-authority/sense\`, or ask ` +
        'without a start point.',
      { cause: error },
    );
  }

  const source = options.index === undefined ? undefined : await scanner.openSourceIndex(options.index);
  const records = await scanner.scanRelations({
    root: options.root,
    dirs: options.dirs ?? ['.'],
    ...(source === undefined ? {} : { cache: source.cache, reuse: source.reuse }),
  });
  await source?.save();

  return treeOf(records, options.root);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
