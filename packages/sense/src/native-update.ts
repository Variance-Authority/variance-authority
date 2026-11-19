/**
 * The warm update of the source index, asked of the addon before anything is
 * opened here.
 *
 * `updateSourceIndex` used to decode the whole chain into objects to learn
 * which records still stood. The addon answers that from the chain in place and
 * from the tree, opens only the files past them, and writes one delta
 * (`native/src/source_update.rs`). What stays this side's is the configuration
 * digest, which `reuse.ts` derives from the resolver options. A chain the
 * addon cannot stand on is rebuilt there from the tree. A directory git does
 * not list is indexed from a walk of the disk, every file read again on every
 * update, under the shape no listed scan reuses.
 */

// compass: variance-authority.reach.source-index

import { native, nativeRefusal } from './addon.js';
import type { NativeGitTree } from './native.js';
import { CODE_EXTENSIONS } from './language.js';
import { BUILTINS } from './native-index-graph.js';
import { LARGEST_FILE } from './scan.js';
import { READABLE } from './language.js';
import { stepped, type Progress } from './progress.js';
import type { ResolveOptions } from './resolve.js';
import { configOf, unlistedShapeOf } from './reuse.js';
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
  readonly builtins: string[];
  readonly codeExtensions: string[];
  readonly readable: string[];
  /** The parse stores read before a file is opened, the first written: `parseStoresFor`. */
  readonly stores?: string[];
  /** `false` reads every file off the working tree. */
  readonly packs?: boolean;
  /** This index as the repository's other checkouts keep it, read when this one has none to stand on. */
  readonly others?: string[];
  /** This index as CI published it, read after `others`, its rows trusted where the tree names their digest. */
  readonly published?: string[];
}
/**
 * CI's index as an update fetches it: whether the update is over another
 * release's index, where it was placed, waited on only when asked, and how to
 * drop it unawaited.
 */
export interface CiSourceIndex {
  readonly over: Promise<boolean>;
  readonly placed: () => Promise<string | undefined>;
  readonly drop: () => void;
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
  readonly from?: string;
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
  /** The index of another checkout this one started from, when it had none to stand on. */
  readonly from?: string;
  /** Git's listing, for a step after this one to carry. Absent when git does not list the directory. */
  readonly listing?: NativeGitTree;
}

/**
 * Update the index at `index` over `dirs` of the checkout at `root` in the addon.
 * `reading` names the read as progress says it: an index started from the stores has no last index to read the changes since.
 * `packs: false` reads every file off the working tree rather than out of Git's object store.
 * `others` is this index as the repository's other checkouts keep it, asked while the tree is listed: one with none to stand on starts from the first that fits.
 * `published` is one CI published, fetched while the tree is listed: tried after `others`, and waited on only when none of
 * them fits, since one on this machine needs no download; when one does, the download is dropped.
 */
export async function updateNatively(
  root: string,
  index: string,
  progress?: Progress,
  dirs: readonly string[] = ['.'],
  stores?: Promise<readonly string[] | undefined>,
  reading = 'reading the files that changed since the last index',
  packs?: boolean,
  others?: Promise<readonly string[]>,
  published?: CiSourceIndex,
): Promise<NativelyUpdated> {
  const tree = await stepped(progress, `listing ${root}`, () => changeTreeOf(root, index, dirs));
  const listed = tree?.native;
  if (listed?.vouched) progress?.('Watchman reports nothing moved since the listing the index holds, so git listed nothing')?.();
  if (listed?.followed) progress?.('Watchman reports what moved since the listing the index holds, so only that was compared')?.();
  const addon = native();
  if (addon === undefined) throw new Error(`no source index for ${root}: the native scanner did not load (${nativeRefusal() ?? ''})`);
  const held = listed ?? await stepped(progress, `walking ${root}, which git does not list`, () => addon.diskTree(root, [...dirs]));
  // The scan this update stands in for reads the same setting, so the digest
  // it compares against the chain is the one that scan wrote.
  const { tsconfig } = withDeclaredTsconfig<ResolveOptions>(root, {});
  const options = tsconfig === undefined ? {} : { tsconfig };
  const { config } = tree === undefined
    ? { config: (await unlistedShapeOf({ root, options })).config }
    : configOf({ root, options });
  // Asked of git while it listed: the stores are needed only now.
  const read = await stores;
  const beside = await others ?? [];
  // Asked once, before the download is waited on: the addon is then handed the answer, the one that fits or none.
  const asked = published !== undefined && beside.length > 0 && await published.over;
  const seeded = asked ? addon.sourceIndexSeed([...beside], config) ?? undefined : undefined;
  const starts = asked ? (seeded === undefined ? [] : [seeded]) : beside;
  if (seeded !== undefined) published?.drop();
  const fetched = seeded === undefined ? await published?.placed() : undefined;
  const done = await stepped(progress, reading, () => held.updateIndex({
    root,
    index,
    config,
    largestFile: LARGEST_FILE,
    ...(tsconfig === undefined ? {} : { tsconfig }),
    builtins: BUILTINS,
    codeExtensions: CODE_EXTENSIONS,
    readable: [...READABLE],
    ...(read === undefined ? {} : { stores: [...read] }),
    ...(packs === undefined ? {} : { packs }),
    ...(starts.length === 0 ? {} : { others: [...starts] }),
    ...(fetched === undefined ? {} : { published: [fetched] }),
  }));
  return {
    files: done.files,
    reread: done.reread,
    parsed: done.parsed,
    ...(done.refused === undefined || done.refused === null ? {} : { refused: done.refused }),
    ...(done.rebuilt === undefined || done.rebuilt === null ? {} : { rebuilt: done.rebuilt }),
    ...(done.written === undefined || done.written === null ? {} : { written: done.written }),
    ...(done.from === undefined || done.from === null ? {} : { from: done.from }),
    ...(listed === undefined ? {} : { listing: listed }),
  };
}
