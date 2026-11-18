/**
 * The warm update of the source index, asked of the addon before anything is
 * opened here.
 *
 * `updateSourceIndex` used to decode the whole chain into objects to learn
 * which records still stood. The addon answers that from the chain in place and
 * from the tree, opens only the files past them, and writes one delta
 * (`native/src/source_update.rs`). What stays this side's is the configuration
 * digest, which `reuse.ts` derives from the resolver options. A chain the
 * addon cannot stand on is rebuilt there from the tree; a directory git does
 * not list has no tree to make an index from, and is refused.
 */

// compass: variance-authority.reach.source-index

import type { NativeGitTree } from './native.js';
import { CODE_EXTENSIONS } from './language.js';
import { BUILTINS } from './native-index-graph.js';
import { LARGEST_FILE } from './scan.js';
import { READABLE } from './language.js';
import { stepped, type Progress } from './progress.js';
import type { ResolveOptions } from './resolve.js';
import { configOf } from './reuse.js';
import { changeTreeOf } from './tree.js';
import { withDeclaredTsconfig } from './typescript.js';

/** `UpdateOptions` in `native/src/source_update.rs`. */
export interface NativeUpdateOptions {
  readonly root: string;
  readonly index: string;
  readonly config: string;
  readonly largestFile?: number;
  readonly tsconfig?: string | false;
  readonly conditionNames?: string[];
  readonly aliases?: string;
  readonly builtins: string[];
  readonly codeExtensions: string[];
  readonly readable: string[];
  /** The parse stores read before a file is opened, the first written: `parseStoresFor`. */
  readonly stores?: string[];
  /** `false` reads every file off the working tree. */
  readonly packs?: boolean;
}
/** `Updated` in `native/src/source_update.rs`. */
export interface NativeUpdated {
  readonly files: number;
  readonly reread: number;
  readonly parsed: number;
  readonly published: boolean;
  readonly refused?: string;
  readonly rebuilt?: 'damaged' | 'other-version';
  readonly written?: number;
}
/** The refusal for a directory git does not list: there is no tree to index. */
export class SourceIndexUnlisted extends Error {
  override readonly name = 'SourceIndexUnlisted';
}

/** What the addon did, and the listing it took. */
export interface NativelyUpdated {
  readonly files: number;
  readonly reread: number;
  readonly parsed: number;
  readonly refused?: string;
  /** Why the chain on disk was rebuilt rather than updated, when it was. */
  readonly rebuilt?: 'damaged' | 'other-version';
  /** The format version another release wrote it in, when `rebuilt` is `other-version`. */
  readonly written?: number;
  readonly listing: NativeGitTree;
}

/**
 * Update the index at `index` over `dirs` of the checkout at `root` in the addon.
 * `reading` names the read as progress says it: an index started from the stores has no last index to read the changes since.
 * `packs: false` reads every file off the working tree rather than out of Git's object store.
 */
export async function updateNatively(
  root: string,
  index: string,
  progress?: Progress,
  dirs: readonly string[] = ['.'],
  stores?: readonly string[] | Promise<readonly string[] | undefined>,
  reading = 'reading the files that changed since the last index',
  packs?: boolean,
): Promise<NativelyUpdated> {
  const tree = await stepped(progress, `listing ${root}`, () => changeTreeOf(root, index, dirs));
  const held = tree?.native;
  if (held?.vouched) progress?.('Watchman reports nothing moved since the listing the index holds, so git listed nothing')?.();
  if (tree === undefined || held === undefined) throw new SourceIndexUnlisted(`no source index for ${root}: git does not list it, and the index is made from git's listing`);
  // The scan this update stands in for reads the same setting, so the digest
  // it compares against the chain is the one that scan wrote.
  const { tsconfig } = withDeclaredTsconfig<ResolveOptions>(root, {});
  const { config, aliases } = await configOf({ root, tree, options: tsconfig === undefined ? {} : { tsconfig } });
  // Asked of git while it listed: the stores are needed only now.
  const read = await stores;
  const done = await stepped(progress, reading, () => held.updateIndex({
    root,
    index,
    config,
    largestFile: LARGEST_FILE,
    ...(tsconfig === undefined ? {} : { tsconfig }),
    ...(aliases === undefined ? {} : { aliases: JSON.stringify(aliases.table) }),
    builtins: BUILTINS,
    codeExtensions: CODE_EXTENSIONS,
    readable: [...READABLE],
    ...(read === undefined ? {} : { stores: [...read] }),
    ...(packs === undefined ? {} : { packs }),
  }));
  return {
    files: done.files,
    reread: done.reread,
    parsed: done.parsed,
    ...(done.refused === undefined || done.refused === null ? {} : { refused: done.refused }),
    ...(done.rebuilt === undefined || done.rebuilt === null ? {} : { rebuilt: done.rebuilt }),
    ...(done.written === undefined || done.written === null ? {} : { written: done.written }),
    listing: held,
  };
}
