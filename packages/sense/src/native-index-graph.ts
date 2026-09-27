/**
 * A cold build's module closure, held by the addon rather than handed over.
 *
 * `nativeGraph` walks the closure and hands every row across, and JavaScript
 * turns each one into a record object, keeps it, and hands all of them back to
 * its encoder. On a repository of a hundred thousand modules those objects and
 * the parses behind them were most of a cold build's memory. This graph keeps
 * the rows where they were built (`native/src/graph_index.rs`) and answers the
 * two questions the scan still asks of the closure — which files it holds, and
 * which files it reaches that it does not — so the scan carries on with the
 * files the walk did not read and never holds the ones it did.
 *
 * What the record is settled against is JavaScript's to say: which names the
 * runtime ships and which extensions carry code. They cross once, as lists
 * computed from the same functions `packageOf` and `kindFor` ask, rather than
 * being written down a second time on the other side.
 */

// compass: variance-authority.reach.source-index

import { builtinModules, isBuiltin } from 'node:module';
import type { FileRecord } from '@variance-authority/core/relate';
import type { Digest } from './digest.js';
import { carriesCode, languageOf, READABLE } from './language.js';
import type { NativeGitTree } from './native.js';
import type { Aliases } from './witness.js';

/** `IndexGraphOptions` in `native/src/graph_index.rs`. */
export interface NativeIndexGraphOptions {
  readonly root: string;
  readonly seeds: string[];
  readonly largestFile?: number;
  readonly readers?: number;
  readonly tsconfig?: string;
  readonly conditionNames?: string[];
  readonly remembering: boolean;
  /** `Aliases.table` as JSON. */
  readonly aliases?: string;
  readonly builtins: string[];
  readonly codeExtensions: string[];
  readonly directories: string[];
}

/** `IndexGraph` in `native/src/graph_index.rs`. */
export interface NativeIndexGraph {
  /** How many files the closure holds. */
  readonly size: number;
  has(file: string): boolean;
  /** Every file an edge reaches that the closure does not hold, sorted by code unit. */
  following(): string[];
  hasParse(key: string): boolean;
  /** The parse layer, encoded as one source-index generation. */
  parseSegment(): Uint8Array;
  /** Every record as a JSON `FileRecord[]`, sorted by file. */
  records(): string;
  /**
   * Publish the parse layer and a generation of every record — the closure's,
   * and those `documents` add — as the first two segments at `path`: what the
   * file system refused, or `null` when it is written.
   */
  publish(path: string, documents: string[]): string | null;
  /** The generation `documents` describe, with every record the closure holds in it. */
  encode(documents: string[]): Uint8Array;
}

/** What a `NativeGitTree` needs besides itself to hold a cold closure. */
export interface IndexGraphRequest {
  readonly root: string;
  readonly seeds: readonly string[];
  readonly largestFile: number;
  readonly tsconfig?: string;
  readonly conditionNames?: readonly string[];
  readonly remembering: boolean;
  readonly aliases: Aliases | undefined;
  readonly directories: ReadonlyMap<string, Digest>;
}

/**
 * Every name `isBuiltin` accepts, with and without its scheme: `packageOf`'s
 * test, as a set the other side can hold.
 */
const BUILTINS = [...new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)])]
  .filter((name) => isBuiltin(name));

/** Every extension `kindFor` keeps a request's kind for: the ones whose language is code. */
const CODE_EXTENSIONS = [...READABLE].filter((suffix) => {
  const language = languageOf(suffix);
  return language !== undefined && carriesCode(language);
});

/**
 * The closure of `seeds`, held by the addon. A failure to build it is a
 * defect, and throws to the scan.
 */
export function nativeIndexGraph(tree: NativeGitTree, request: IndexGraphRequest): NativeIndexGraph {
  return tree.indexGraph({
    root: request.root,
    seeds: [...request.seeds],
    largestFile: request.largestFile,
    ...(request.tsconfig === undefined ? {} : { tsconfig: request.tsconfig }),
    ...(request.conditionNames === undefined ? {} : { conditionNames: [...request.conditionNames] }),
    remembering: request.remembering,
    ...(request.aliases === undefined ? {} : { aliases: JSON.stringify(request.aliases.table) }),
    builtins: BUILTINS,
    codeExtensions: CODE_EXTENSIONS,
    directories: [...request.directories.keys()],
  });
}

/** The closure's records, as objects: the path for a caller that is owed them. */
export function graphRecords(graph: NativeIndexGraph): readonly FileRecord[] {
  return JSON.parse(graph.records()) as FileRecord[];
}
