import type { EdgeKind, FileRecord } from '@variance-authority/core/relate';
import { openSourceTree, readSourceParses, sourceTreeOf, updateSourceIndex, type Parsed, type SourceTree } from '@variance-authority/sense';
import { relative } from 'node:path';
import { namesOf, type FileNames, type SourceNames } from './names.js';
import { encodeSourceTree } from './source-tree-format.js';

/**
 * The source tree, the one authority on whether a path exists and what it
 * reaches. A run's notes say which files were seen rendering, which is wrong
 * both ways about what is on disk; the index holds the files and the arrows
 * between them, and cannot answer *maybe*. A walk runs one way, along or
 * against the arrows, at any depth, over every edge kind, `type` included. The
 * tree is the addon's, read where it was written: nothing its size is built here.
 */

/** The scanned tree, and the questions a start point asks of it. */
export interface Tree {
  /** The repository the coordinates are relative to. */
  readonly root: string;
  /**
   * Where the walks' answers are relative to, when it is not `root`: the graph
   * a workspace nested below it was drawn over. A start point is said from
   * `root`; a file a walk names is opened from here.
   */
  readonly graphRoot?: string;
  /** How many files the tree holds a coordinate for. */
  readonly size: number;
  /** Whether the tree holds a file at `file`, repo-relative, forward slashes, compared whole. */
  has(file: string): boolean;
  /** Every file the tree holds, in code-unit order, read a page at a time. */
  files(): Iterable<string>;
  /**
   * The files a start point names, `said` from the root: at `file` width the
   * file, or the folder of that name when no file is there; at `under` every
   * file below the folder; at `own` the folder's own files.
   */
  entries(said: string, width: 'file' | 'under' | 'own'): readonly string[];
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
  /** Minimum import distance from the seeds to every reachable file: a seed is at zero and every arrow adds one. */
  distanceFrom(seeds: Iterable<string>): ReadonlyMap<string, number>;
  /** The same minimum distance against the arrows. */
  distanceTo(seeds: Iterable<string>): ReadonlyMap<string, number>;
  /**
   * Files whose imports could not be enumerated — an unreadable file, a
   * specifier nothing resolved. The graph keeps the edges such a file does
   * state, and nothing is widened for the one nobody could read: a scope rests
   * on the edges the scan read, and these are counted and said beside it.
   */
  unknownAmong(files: Iterable<string>): readonly string[];
  /** Every file of the tree whose imports could not be enumerated, as {@link Tree.unknownAmong} says them. */
  unknownFiles(): readonly string[];
  /**
   * The walk {@link Tree.distanceTo} answers, kept so each file it reached can
   * say how: one shortest chain of imports from that file to a seed. A chain
   * costs its length, so a caller that shows ten rows of a walk that reached a
   * hundred thousand files pays for ten chains.
   */
  chainsTo(seeds: Iterable<string>): Chains;
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
 * The tree a pile of scanned records makes, as a workspace at `workspace`
 * below `root` sees it.
 *
 * Separate from the scan on purpose: the rule about paths is decided here and
 * can be tested with a handful of records, without a repository on disk and
 * without the parser.
 */
export function treeOf(records: Iterable<FileRecord>, root = '.', workspace = root): Tree {
  return publishedTreeOf(encodeSourceTree([...records]), root, workspace);
}

/** The tree in a published source-tree segment, as a workspace at `workspace` below `root` sees it. */
export function publishedTreeOf(bytes: Uint8Array, root: string, workspace = root): Tree {
  const prefix = relative(root, workspace).replaceAll('\\', '/');
  const nested = prefix !== '' && !prefix.startsWith('..');
  return treeAt(openSourceTree(bytes, nested ? prefix : ''), nested ? workspace : root, nested ? root : undefined);
}

/** How many paths a page of {@link Tree.files} carries across. */
const PAGE = 4096;

function treeAt(native: SourceTree, root: string, graphRoot?: string): Tree {
  const walk = (seeds: Iterable<string>, against: boolean) => native.walk([...seeds], against);
  return {
    root,
    ...(graphRoot === undefined ? {} : { graphRoot }),
    size: native.size,
    has: (file) => native.has(file),
    *files() {
      for (let from = 0; from < native.size; from += PAGE) yield* native.paths(from, PAGE);
    },
    entries: (said, width) => native.entries(said, width),
    reachedFrom: (seeds) => new Set(walk(seeds, false).files()),
    reaching: (seeds) => new Set(walk(seeds, true).files()),
    distanceFrom: (seeds) => distances(walk(seeds, false)),
    distanceTo: (seeds) => distances(walk(seeds, true)),
    unknownAmong: (among) => native.unknownAmong([...among]),
    unknownFiles: () => native.unknownFiles(),
    chainsTo(seeds) {
      const walked = walk(seeds, true);
      return {
        distance: distances(walked),
        chain: (file) => walked.chain(file).map((link) => (link.kind == null ? { file: link.file } : { file: link.file, kind: link.kind as EdgeKind })),
      };
    },
  };
}

function distances(walked: ReturnType<SourceTree['walk']>): ReadonlyMap<string, number> {
  const depths = walked.depths();
  return new Map(walked.files().map((file, at) => [file, depths[at]!]));
}

/** What reading the tree needs to be told, beyond where the repository is. */
export interface TreeOptions {
  /** The repository root. Every coordinate comes back relative to it. */
  readonly root: string;
  /**
   * The source index, when the caller keeps one somewhere other than the
   * checkout's own, which is written to in the cache directory when absent.
   *
   * It is updated before it is read, so a question asked after a one-file edit
   * re-reads that file and holds every other record as it was.
   */
  readonly index?: string;
  /**
   * Receives every file's names, read off the parses the index holds, once
   * the tree is read. Asked for only by a question that names a name: holding
   * them costs a map the size of the tree, which a question about paths would
   * pay for nothing.
   */
  readonly names?: (names: SourceNames) => void;
}

/**
 * Read the tree. An index the update could not write throws: what is on disk
 * is the tree before the edit, and a start point resolved against something
 * that is not the tree is the defect this module exists to remove.
 */
export async function readTree(options: TreeOptions): Promise<Tree> {
  // The addon brings the index up to date over what git says moved; the tree
  // and the names are read off what it wrote, so no file is read on this side.
  const updated = await updateSourceIndex(
    options.root,
    options.index === undefined ? {} : { index: options.index },
  );
  if (updated.refused !== undefined) throw new Error(updated.refused);
  // The graph every reader of the checkout walks, with the mocks read off
  // what the parse recorded, so it is the graph `variance covering --since` cuts by.
  const drawn = await sourceTreeOf(options.root, updated.path);
  if (drawn === null) throw new Error(`no source index was published at ${updated.path}`);
  if (options.names !== undefined) options.names(await readIndexedNames(updated.path));
  return treeAt(drawn, options.root);
}

/**
 * Every file's names, read off the parses the source index at `index` holds:
 * what a question that names a name reads when it answers from the generation
 * `variance index` published, so the checkout is neither scanned nor compared
 * and the index is not written. Keyed as the index keys its files, which is
 * how a walk over the published tree answers.
 */
export async function readIndexedNames(index: string): Promise<SourceNames> {
  const names = new Map<string, FileNames>();
  for (const { file, parsed, targets } of await readSourceParses(index)) nameInto(names, file, parsed, targets);
  return names;
}

/** One file's names, for the scan and the published read alike: a parse that holds no declarations is left out, which counts its file as unread rather than declaring nothing. */
function nameInto(names: Map<string, FileNames>, file: string, parsed: Parsed, targets: readonly (string | undefined)[]): void {
  if (parsed.harvested === true) names.set(file, namesOf(parsed, targets));
}
