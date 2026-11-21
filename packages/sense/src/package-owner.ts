// compass: variance-authority.reach.relations

import { native, nativeRefusal } from './addon.js';

/** What one path says under a listed package set and the extensions source is written in. */
export interface PathKind {
  /** The deepest listed package holding it, or `.` when none does. */
  readonly owner: string;
  /** Its package, or its top folder when it is in none: `.` for a file at the root. */
  readonly tree: string;
  /** Named as a test, or with the tests, read from inside its package. */
  readonly test: boolean;
  /** One of the source extensions, and no test. */
  readonly source: boolean;
}

/** The trees of a checkout that hold source, or what git said when it could not list them. */
export interface SourceTrees {
  readonly trees: readonly string[];
  /** What the addon ran and what git said; then there are no trees. */
  readonly refused?: string | null;
}

/** The addon's reading of paths under one listed package set: `source_trees.rs`. */
export interface PathKinds {
  owner(file: string): string;
  /** Per file, in order: what the caller asked, never every file of the checkout. */
  of(files: string[]): PathKind[];
  /** The trees of the files `HEAD` holds under `root` that hold source; only the trees cross. */
  sourceTrees(root: string): SourceTrees;
}

export interface NativePaths {
  pathKinds(packages: string[], extensions: string[]): PathKinds;
  testPathPatterns(): { readonly named: string; readonly withTheTests: string };
}

/** The addon's path rules, or a refusal that says why it cannot answer. */
export function nativePaths(): NativePaths {
  const addon = native();
  if (addon === undefined) throw new Error(`a path is read by the native scanner: ${nativeRefusal() ?? 'it is unavailable'}`);
  return addon;
}

/**
 * How paths read under `packages`, a package here a listed one: a manifest no
 * workspace pattern lists is part of the listed package around it. A file is
 * source when it has one of `extensions` and is no test.
 */
export function pathKinds(packages: Iterable<string>, extensions: Iterable<string>): PathKinds {
  return nativePaths().pathKinds([...packages], [...extensions]);
}

/**
 * The package a file is in: the deepest of `packages` that holds it, so a
 * package nested in another owns its own files, or `.` when none does. The
 * rule is the addon's, which `containment` reads every file `HEAD` holds by.
 */
export function packageOwner(packages: readonly string[]): (file: string) => string {
  const kinds = pathKinds(packages, []);
  return (file) => kinds.owner(file);
}
