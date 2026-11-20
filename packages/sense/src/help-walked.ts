/**
 * The walk with no index, joined by the addon: what `readHelp` in
 * `@variance-authority/help` read from disk goes through the join the index's
 * publish runs, so the rule that turns names and uses into entries, and the one
 * that finds a README's mention of a name, are each written once, in Rust.
 */

// compass: variance-authority.report.agent-surface

import { entry, type PublishPackage, type StoreUse } from './help-reading.js';

/** The first declaration read of one kind of a published name. */
export interface ReachedDeclaration {
  /** As the parser harvested it, or `foreign`, or `namespace-object` for a module held whole. */
  readonly kind: string;
  readonly at: string;
  readonly line: number;
  readonly signature?: string | null;
  readonly doc?: string | null;
  readonly declared: string;
}

/** One name an opening hands out, and its kinds in the order they were read: the first carries the place and the prose. */
export interface PublishedName {
  readonly name: string;
  readonly kinds: readonly ReachedDeclaration[];
}

/** One use through an opened `<package> .<subpath>` key, of the name it takes, its `through` laid flat as {@link StoreUse}'s. */
export interface NameUse extends Omit<StoreUse, 'name'> {
  readonly key: string;
  readonly name: string;
}

/** What the walk with no index read: the manifests' packages, each opening's names flat in their order, and every use through an opened key. */
export interface WalkedHelp {
  /** The directory every recorded path is relative to, under which READMEs are read. */
  readonly readmeRoot: string;
  readonly packages: readonly PublishPackage[];
  readonly names: readonly (readonly PublishedName[])[];
  readonly uses: readonly NameUse[];
}

/** Where a README names a symbol: the README relative to the root, the 1-based line the passage begins on, and the passage. */
export interface Mention {
  readonly at: string;
  readonly line: number;
  readonly text: string;
}

/**
 * The walk's packages joined as the index's publish joins them, each name with
 * no doc comment given what its nearest README says of it, as a store holding
 * only them. Throws naming a README that is there and does not read, or a name
 * with no declaration behind it.
 */
export function joinWalkedHelp(walked: WalkedHelp): Uint8Array {
  return entry('joinWalkedHelp')(walked);
}

/**
 * Where the nearest README above `at`, relative to `root`, names `name`: the
 * paragraph of its best whole-word occurrence, or the fence it falls in.
 * `undefined` when no README is above it or the nearest does not name it;
 * throws when the nearest is there and does not read.
 */
export function readmeMention(root: string, at: string, name: string): Mention | undefined {
  return entry('readmeMention')(root, at, name) ?? undefined;
}
