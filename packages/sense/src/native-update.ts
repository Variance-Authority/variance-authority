/**
 * The warm update of the source index, asked of the addon before anything is
 * opened here.
 *
 * `updateSourceIndex` used to decode the whole chain into objects to learn
 * which records still stood. The addon answers that from the chain in place and
 * from the tree, opens only the files past them, and writes one delta
 * (`native/src/source_update.rs`). What stays this side's is the configuration
 * digest, which `reuse.ts` derives from the resolver options. The addon
 * declines with `null` — no chain, a legacy one, another configuration, a file
 * it does not read — and the caller runs the update it always had.
 */

// compass: variance-authority.reach.source-index

import type { NativeGitTree } from './native.js';
import { BUILTINS, CODE_EXTENSIONS } from './native-index-graph.js';
import { LARGEST_FILE } from './scan.js';
import { READABLE } from './language.js';
import { shapeOf } from './reuse.js';
import { gitTreeOf } from './tree.js';

/** `UpdateOptions` in `native/src/source_update.rs`. */
export interface NativeUpdateOptions {
  readonly root: string;
  readonly index: string;
  readonly config: string;
  readonly largestFile?: number;
  readonly tsconfig?: string;
  readonly conditionNames?: string[];
  readonly aliases?: string;
  readonly builtins: string[];
  readonly codeExtensions: string[];
  readonly readable: string[];
}
/** `Updated` in `native/src/source_update.rs`. */
export interface NativeUpdated {
  readonly files: number;
  readonly reread: number;
  readonly published: boolean;
  readonly refused?: string;
}
/** What the addon did, and the listing it took. */
export interface NativelyUpdated {
  readonly files: number;
  readonly reread: number;
  readonly refused?: string;
  readonly listing: NativeGitTree;
}

/** Update the index at `index` over the checkout at `root` in the addon, or `undefined` when the JavaScript update has to. */
export async function updateNatively(root: string, index: string): Promise<NativelyUpdated | undefined> {
  const tree = await gitTreeOf(root, ['.']);
  const held = tree?.native;
  if (tree === undefined || held?.updateIndex === undefined) return undefined;
  const { shape, aliases } = await shapeOf({ root, tree });
  const done = held.updateIndex({
    root,
    index,
    config: shape.config,
    largestFile: LARGEST_FILE,
    ...(aliases === undefined ? {} : { aliases: JSON.stringify(aliases.table) }),
    builtins: BUILTINS,
    codeExtensions: CODE_EXTENSIONS,
    readable: [...READABLE],
  });
  if (done === null) return undefined;
  return {
    files: done.files,
    reread: done.reread,
    ...(done.refused === undefined || done.refused === null ? {} : { refused: done.refused }),
    listing: held,
  };
}
