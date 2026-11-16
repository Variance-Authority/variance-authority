/** The native source-index lifecycle: configuration and progress cross this boundary; source bytes, records and publication stay in the addon. */

// compass: variance-authority.reach.source-index

import type { NativeGitTree } from './native.js';
import type { SourceIndexState } from './source-index-file.js';
import { CODE_EXTENSIONS } from './language.js';
import { BUILTINS } from './native-index-graph.js';
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
  readonly packs?: boolean;
  readonly tsconfig?: string | false;
  readonly conditionNames?: string[];
  readonly aliases?: string;
  readonly builtins: string[];
  readonly codeExtensions: string[];
  readonly readable: string[];
  /** The parse stores read before a file is opened, the first written: `parseStoresFor`. */
  readonly stores?: string[];
}
/** `Updated` in `native/src/source_update.rs`. */
export interface NativeUpdated {
  readonly was: SourceIndexState;
  readonly written?: number;
  readonly files: number;
  readonly reread: number;
  readonly parsed: number;
  readonly published: boolean;
  readonly refused?: string;
}
/** What the addon did, and the listing it took. */
export interface NativelyUpdated {
  readonly was: SourceIndexState;
  readonly written?: number;
  readonly files: number;
  readonly reread: number;
  readonly parsed: number;
  readonly refused?: string;
  readonly listing?: NativeGitTree;
}

/**
 * Update the index at `index` over `dirs` in the addon; `undefined` means the native lifecycle could not run.
 * `reading` names the read as progress says it: an index started from the stores has no last index to read the changes since.
 */
export async function updateNatively(
  root: string,
  index: string,
  progress?: Progress,
  dirs: readonly string[] = ['.'],
  stores?: readonly string[],
  reading = 'reading the files that changed since the last index',
  packs?: boolean,
): Promise<NativelyUpdated | undefined> {
  const tree = await stepped(progress, `listing ${root}`, () => changeTreeOf(root, index, dirs));
  const held = tree?.native;
  if (held?.vouched) progress?.('Watchman reports nothing moved since the listing the index holds, so git listed nothing')?.();
  if (tree === undefined || held?.updateIndex === undefined) return undefined;
  // The scan this update stands in for reads the same setting, so the digest
  // it compares against the chain is the one that scan wrote.
  const { tsconfig, config, aliases } = await stepped(undefined, 'source resolution configuration', async () => {
    const { tsconfig } = withDeclaredTsconfig<ResolveOptions>(root, {});
    return { tsconfig, ...await configOf({ root, tree, options: {
      ...(tsconfig === undefined ? {} : { tsconfig }),
      ...(packs === undefined ? {} : { packs }),
    } }) };
  });
  const done = await stepped(progress, reading, () => held.updateIndex!({
    root,
    index,
    config,
    ...(packs === undefined ? {} : { packs }),
    ...(tsconfig === undefined ? {} : { tsconfig }),
    ...(aliases === undefined ? {} : { aliases: JSON.stringify(aliases.table) }),
    builtins: BUILTINS,
    codeExtensions: CODE_EXTENSIONS,
    readable: [...READABLE],
    ...(stores === undefined ? {} : { stores: [...stores] }),
  }));
  if (done === null) return undefined;
  return {
    was: done.was,
    ...(done.written === undefined || done.written === null ? {} : { written: done.written }),
    files: done.files,
    reread: done.reread,
    parsed: done.parsed,
    ...(done.refused === undefined || done.refused === null ? {} : { refused: done.refused }),
    listing: held,
  };
}
