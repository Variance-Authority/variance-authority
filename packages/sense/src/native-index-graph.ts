/**
 * Native source closures and their existing binary source-index generations.
 *
 * Records, resolution and parses stay native until a public consumer requests
 * their values. The scan supplies only runtime builtins and source extensions.
 */

// compass: variance-authority.reach.source-index

import { builtinModules, isBuiltin } from 'node:module';
import type { Digest } from '@variance-authority/core/format';
import { CODE_EXTENSIONS } from './language.js';
import type { NativeGitTree } from './native.js';
import type { Aliases } from './witness.js';

/** Opaque Rust preparation owned by one scan and discarded when it returns. */
export interface NativeScanSession { readonly __nativeScanSession: unique symbol }

/** `IndexGraphOptions` in `native/src/graph_index.rs`. */
export interface NativeIndexGraphOptions {
  readonly root: string;
  readonly seeds: string[];
  readonly largestFile?: number;
  readonly packs?: boolean;
  readonly readers?: number;
  readonly tsconfig?: string | false;
  readonly conditionNames?: string[];
  readonly remembering: boolean;
  /** `Aliases.table` as JSON. */
  readonly aliases?: string;
  readonly builtins: string[];
  readonly codeExtensions: string[];
  readonly directories: string[];
  /**
   * Parse stores consulted by content identity. Eligible Git or supplied
   * identities allow lookup before acquisition; other reads prove identity
   * from their bytes first.
   */
  readonly stores?: string[];
  readonly identities?: Readonly<Record<string, string>>;
  readonly follow?: boolean;
  readonly priorParses?: Uint8Array;
}

/** `IndexGraph` in `native/src/graph_index.rs`. */
export interface NativeIndexGraph {
  /** How many files the closure holds. */
  readonly size: number;
  /** How many of them it parsed: a module declined for its bytes holds a record and no parse. */
  readonly parsed: number;
  has(file: string): boolean;
  /** Every file an edge reaches that the closure does not hold, sorted by code unit. */
  following(): string[];
  hasParse(key: string): boolean;
  /** The parse layer, encoded as one source-index generation. */
  parseSegment(): Uint8Array;
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
  readonly session?: NativeScanSession;
  readonly root: string;
  readonly seeds: readonly string[];
  readonly largestFile: number;
  readonly packs?: boolean;
  readonly tsconfig?: string | false;
  readonly conditionNames?: readonly string[];
  readonly remembering: boolean;
  readonly aliases: Aliases | undefined;
  readonly directories: ReadonlyMap<string, Digest>;
  readonly stores?: readonly string[];
  readonly identities?: Readonly<Record<string, string>>;
  readonly follow?: boolean;
  readonly priorParses?: Uint8Array;
}

/**
 * Every name `isBuiltin` accepts, with and without its scheme: `packageOf`'s
 * test, as a set the other side can hold.
 */
export const BUILTINS = [...new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)])]
  .filter((name) => isBuiltin(name));

/**
 * The closure of `seeds`, held by the addon. A failure to build it is a
 * defect, and throws to the scan.
 */
export function nativeIndexGraph(tree: NativeGitTree, request: IndexGraphRequest): NativeIndexGraph {
  return tree.indexGraph({
    root: request.root,
    seeds: [...request.seeds],
    largestFile: request.largestFile,
    ...(request.packs === undefined ? {} : { packs: request.packs }),
    ...(request.tsconfig === undefined ? {} : { tsconfig: request.tsconfig }),
    ...(request.conditionNames === undefined ? {} : { conditionNames: [...request.conditionNames] }),
    remembering: request.remembering,
    ...(request.aliases === undefined ? {} : { aliases: JSON.stringify(request.aliases.table) }),
    builtins: BUILTINS,
    codeExtensions: CODE_EXTENSIONS,
    directories: [...request.directories.keys()],
    ...(request.stores === undefined ? {} : { stores: [...request.stores] }),
    ...(request.identities === undefined ? {} : { identities: request.identities }),
    ...(request.follow === undefined ? {} : { follow: request.follow }),
    ...(request.priorParses === undefined ? {} : { priorParses: request.priorParses }),
  }, request.session);
}
