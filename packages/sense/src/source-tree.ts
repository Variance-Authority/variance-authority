/**
 * The source tree a path question opens, held by the addon.
 *
 * The addon writes the tree; it is the one that reads it. A question hands it
 * the start point and the direction, the walk runs there over every file and
 * import, and what comes back is the answer: the files reached, their
 * distances, the chain of a file asked. Nothing the size of the tree is built
 * on this side, which on a workspace of hundreds of thousands of files is what
 * a path question could not afford.
 */

// compass: variance-authority.reach.source-index

import { entry, mocking } from './help-reading.js';
import { sourceIndexPath } from './source-index.js';

/** One file on a chain, and the kind of import it takes towards the seed; absent on the seed. */
export interface SourceLink {
  readonly file: string;
  readonly kind?: string | null;
}

/** One import from a file a walk reached into a file asked about. */
export interface SourceEdge {
  readonly from: string;
  readonly to: string;
}

/** A walk over a {@link SourceTree}; every path it takes and gives is below the graph root. */
export interface SourceWalk {
  /** How many files the walk reached, seeds included. */
  readonly count: number;
  /** Every file reached, in code-unit order. */
  files(): string[];
  /** The distance of each of {@link SourceWalk.files}, in its order. */
  depths(): number[];
  distance(file: string): number | null;
  /** One shortest chain from `file` back to a seed: `file` first, the seed last. */
  chain(file: string): SourceLink[];
  /** The same chain read from the seed. */
  trail(file: string): string[];
  /** Every import from a reached file into one of `files`, once each. */
  edgesInto(files: string[]): SourceEdge[];
}

/**
 * The tree as one workspace sees it. Its own files are said from it; a seed
 * is its file when it holds one at that path, else the graph's.
 */
export interface SourceTree {
  /** How many files the workspace holds. */
  readonly size: number;
  has(file: string): boolean;
  /** The workspace's files from the `from`th, at most `limit` of them. */
  paths(from: number, limit: number): string[];
  /** The workspace's files a start point names: `width` is `file`, `under` or `own`. */
  entries(said: string, width: string): string[];
  /** Those of `files`, below the graph root, whose imports could not all be read, sorted. */
  unknownAmong(files: string[]): string[];
  /** Every workspace file whose imports could not all be read, below the graph root. */
  unknownFiles(): string[];
  /** The files `file`, below the graph root, imports. */
  targets(file: string): string[];
  /** Every file reachable from `seeds` along the imports, or against them, never entering `avoid`. */
  walk(seeds: string[], against: boolean, avoid?: string[] | null): SourceWalk;
}

/** The tree in `bytes`, as a workspace `workspace` below its root sees it; `''` for the root. */
export function openSourceTree(bytes: Uint8Array, workspace = ''): SourceTree {
  return entry('openSourceTree')(bytes, workspace);
}

/** The tree drawn from the source index at `index`, the graph `variance covering --since` cuts by; `null` when none was published. */
export function sourceTreeOf(root: string, index: string = sourceIndexPath(root)): Promise<SourceTree | null> {
  return entry('sourceTreeOf')(root, index, ...mocking(root));
}
