import {
  EDGE_KINDS,
  dependenciesOf,
  dependentsOf,
  idOf,
  nodeAt,
  nodesOfKind,
  relationsOfFiles,
  trailOf,
  type EdgeKind,
  type FileRecord,
  type Traversal,
  type NodeId,
  type Relations,
} from '@variance-authority/core/relate';
import { relative } from 'node:path';
import { costsFrom } from './hops.js';
import { namesOf, type FileNames, type SourceNames } from './names.js';

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
 * Every edge kind is walked, `type` included: a reader asking where something
 * lives is asking about source, and a type a component imports is a file in its
 * neighbourhood by any reading a person would recognise.
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
   * The graph keeps the edges such a file does state and has none for the one
   * nobody could read, the same as every other walk over it: nothing is widened
   * for an unread import, and the recorded run is what sees the module it loads.
   * So a scope rests on the edges the scan read, and these are counted and said
   * beside it — every file that imports an unknown one is 209 of the 1,574 files
   * in this repository, which is a number no start point could survive being
   * unioned with.
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
  /**
   * The walk {@link Tree.distanceTo} answers, kept so each file it reached can
   * say how: one shortest chain of imports from that file to a seed.
   *
   * The same breadth-first search, read twice — once for the distances and
   * once, per file asked, back along its parent pointers. A chain costs its
   * length, so a caller that shows ten rows of a walk that reached a hundred
   * thousand files pays for ten chains.
   */
  chainsTo(seeds: Iterable<string>): Chains;
  /**
   * The graph the walks above read, with what each test file mocks beside it.
   *
   * A question about which cases stand on a module needs to know which of them
   * ran against a mock of it, and that is a fact about the tree, not about the
   * run. Absent on a tree that holds no such graph — a view onto another root's
   * coordinates — and a tool that needs it says it answered without it.
   */
  readonly relations?: Relations;
}

/** What rests on a set of files, and the evidence for each. */
export interface Chains {
  /** Every file reached against the imports, seeds at zero, in code-unit order. */
  readonly distance: ReadonlyMap<string, number>;
  /**
   * One shortest chain from `file` to a seed: `file` first, the seed last, and
   * on every step but the last the kind of the import it takes to the next.
   * The same chain on every call. Empty for a file the walk did not reach.
   */
  chain(file: string): readonly Link[];
}

/** One file on a chain, and the import it takes towards the seed. */
export interface Link {
  readonly file: string;
  /** Absent on the seed, which imports nothing further along the chain. */
  readonly kind?: EdgeKind;
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
    chainsTo: (seeds) => chainsTo(relations, seeds),
    relations,
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
    chainsTo: (values) => tree.chainsTo(seeds(values)),
  };
}

/** Minimum edge count to every reached file, recovered from the BFS forest. */
function distances(
  relations: Relations,
  seeds: Iterable<string>,
  direction: Direction,
): ReadonlyMap<string, number> {
  return depthsOf(relations, direction(relations, idsOf(relations, seeds), { through: EDGE_KINDS }));
}

function chainsTo(relations: Relations, seeds: Iterable<string>): Chains {
  const traversal = dependentsOf(relations, idsOf(relations, seeds), { through: EDGE_KINDS });
  return {
    distance: depthsOf(relations, traversal),
    chain(file) {
      const id = idOf(relations, 'file', file);
      if (id === undefined) return [];
      // The trail runs seed first; a chain is read from the file that reaches.
      const trail = [...trailOf(traversal, id)].reverse();
      return trail.map((at, step) =>
        step === trail.length - 1
          ? { file: relations.names[at]! }
          : { file: relations.names[at]!, kind: importKind(relations, at, trail[step + 1]!) },
      );
    },
  };
}

/**
 * The kind of the import `from` makes of `to`. A file that imports another
 * both ways is said by the import that runs: the type one is the weaker claim.
 */
function importKind(relations: Relations, from: NodeId, to: NodeId): EdgeKind {
  const { offset, target, kind } = relations.depends;
  let found: EdgeKind | undefined;
  for (let at = offset[from]!; at < offset[from + 1]!; at += 1) {
    if (target[at] !== to) continue;
    const held = EDGE_KINDS[kind[at]!]!;
    if (held !== 'type') return held;
    found = held;
  }
  return found!;
}

function depthsOf(relations: Relations, traversal: Traversal): ReadonlyMap<string, number> {
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
  /**
   * Receives every file's names, read off the parses that drew the tree, once
   * the scan is done. Asked for only by a question that names a name: holding
   * them costs a map the size of the tree, which a question about paths would
   * pay for nothing.
   */
  readonly names?: (names: SourceNames) => void;
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
  const names = options.names === undefined ? undefined : new Map<string, FileNames>();
  const records = await scanner.scanRelations({
    root: options.root,
    dirs: options.dirs ?? ['.'],
    ...(source === undefined ? {} : { cache: source.cache, reuse: source.reuse }),
    ...(names === undefined ? {} : {
      // A parse that holds no declarations is left out of the names, which
      // counts its file as unread rather than declaring nothing.
      indexed: (file, parsed, targets) => {
        if (parsed.harvested === true) names.set(file, namesOf(parsed, targets));
      },
    }),
  });
  // The mocks are read unasked, off what the parse recorded, as every reader of
  // the checkout's graph reads them: a case whose file mocked a module ran
  // against the mock, and a graph that did not say so would credit it.
  const tainted = await scanner.taintRecords(records, [scanner.mockTaint()], {
    root: options.root,
    ...(source === undefined ? {} : { cache: source.cache }),
  });
  await source?.save();
  if (names !== undefined) options.names?.(names);

  return treeFromRelations(relationsOfFiles(tainted.records, { shadows: tainted.shadows }), options.root);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
