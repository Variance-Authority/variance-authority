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
}

/**
 * The tree a pile of scanned records makes.
 *
 * Pure, and separate from the scan on purpose: the rule about paths is decided
 * here and can be tested with a handful of records, without a repository on
 * disk and without the parser.
 */
export function treeOf(records: Iterable<FileRecord>, root = '.'): Tree {
  const relations = relationsOfFiles(records);
  const files = new Set<string>();
  for (const id of nodesOfKind(relations, 'file')) files.add(relations.names[id]!);

  return {
    root,
    files,
    reachedFrom: (seeds) => walk(relations, seeds, dependenciesOf),
    reaching: (seeds) => walk(relations, seeds, dependentsOf),
    unknownAmong: (among) => unknownAmong(relations, among),
  };
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
  const reach = direction(relations, ids, { through: EDGE_KINDS });
  for (const id of reach.reached) {
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
