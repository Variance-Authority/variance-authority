import { createHash, randomUUID } from 'node:crypto';
import { closeSync, openSync, readSync, realpathSync } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  decodeSourceTree,
  treeAtWorkspace,
  treeOf,
  type FileRecord,
  type Tree,
} from '@variance-authority/mcp/tools';
import { SegmentCutShort } from '@variance-authority/core/segment';
import type { Help } from '@variance-authority/package/help';
import { readSourceRecords, restampHelpStore, sourceIndexPath } from '@variance-authority/sense';
import { openHelpStore, openSearchIndex, type SearchIndex } from './search-index.js';
import { encodeStore } from './store-encode.js';
import { storeHeadOf, type StoreHead } from './store-layout.js';

export interface SnapshotOptions {
  /** The source index this reading was published beside. */
  readonly index?: string;
  /** Handed the recorded graph without consulting the checkout. */
  readonly records?: (records: readonly FileRecord[], graphRoot: string) => void;
  /** Handed the published graph without decoding the source index. */
  readonly tree?: (tree: Tree) => void;
}

const generated = new WeakMap<Help, string>();
const snapshots = new WeakMap<Help, StoreHead>();
const searches = new WeakMap<Help, SearchIndex>();
const stores = new WeakMap<Help, Uint8Array>();

/** When the workspace value was published, absent on an unrecorded reading. */
export function workspaceGeneration(help: Help): string | undefined {
  return generated.get(help);
}

/** When the read behind the workspace value began, in milliseconds, absent on an unrecorded reading. */
export function workspaceReadStarted(help: Help): number | undefined {
  const held = snapshots.get(help);
  return held === undefined ? undefined : Date.parse(held.readStartedAt);
}

/**
 * The answerable workspace value published beside one source-index generation:
 * one binary store holding the packages, the imports by path, the export list
 * and the search over them, opened in place, with the generation in its head.
 */
export function workspaceSnapshotPath(index: string): string {
  return `${index}.help.bin`;
}

/** Read the last published value without inspecting the checkout or asking Git. */
export async function readWorkspaceSnapshot(
  root: string,
  options: SnapshotOptions = {},
): Promise<Help> {
  const where = realpathSync(resolve(root));
  const index = options.index ?? sourceIndexPath(where);
  const at = workspaceSnapshotPath(index);
  let bytes: Uint8Array;
  let opened: ReturnType<typeof openHelpStore>;
  try {
    bytes = await readFile(at);
    opened = openHelpStore(bytes);
  } catch (error) {
    throw new Error(
      `no readable workspace snapshot at ${at}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  const held = opened.generation;
  if (held === undefined) throw new Error(`the workspace snapshot at ${at} carries no generation`);
  if (held.root !== where) {
    throw new Error(`the workspace snapshot at ${at} belongs to ${held.root}, not ${where}`);
  }
  if (options.tree !== undefined) {
    const tree = await readFile(workspaceTreePath(index, held.graphDigest));
    if (hexDigestOf(tree) !== held.graphDigest) {
      throw new Error(`the workspace source tree beside ${at} does not belong to that generation`);
    }
    options.tree(publishedTree(tree, held.graphRoot, held.root));
  }
  if (options.records !== undefined) {
    options.records(await readSourceRecords(index), held.graphRoot);
  }
  const { help } = opened;
  generated.set(help, held.generatedAt);
  snapshots.set(help, held);
  searches.set(help, opened.search);
  stores.set(help, bytes);
  return help;
}

/**
 * The generation published at `index`, read off the store's head alone: the
 * rest is every export of the repository, and a caller asking whether its write
 * landed has no use for it. Absent when there is none, or it is not this format.
 */
export function publishedHead(index: string): StoreHead | undefined {
  let file: number;
  try {
    file = openSync(workspaceSnapshotPath(index), 'r');
  } catch {
    return undefined;
  }
  try {
    // The header's length, then the header, then the head: each read names the next.
    let length = 4;
    for (let read = 0; read < 3; read += 1) {
      const held = Buffer.alloc(length);
      if (readSync(file, held, 0, length, 0) !== length) return undefined;
      try {
        return storeHeadOf(held);
      } catch (error) {
        if (!(error instanceof SegmentCutShort) || error.needed <= length) return undefined;
        length = error.needed;
      }
    }
    return undefined;
  } catch {
    return undefined;
  } finally {
    closeSync(file);
  }
}

/**
 * When the value at `index` was published, as {@link publishedHead} reads it.
 * Absent when there is no value, or it belongs to another checkout or format.
 */
export async function publishedGeneration(root: string, index: string): Promise<string | undefined> {
  const where = realpathSync(resolve(root));
  const held = publishedHead(index);
  return held?.root === where ? held.generatedAt : undefined;
}

/**
 * Whether a server holding `held` reads the workspace again before it answers:
 * when it holds none, when a generation newer than `held` was published since —
 * `variance index`, or another reader — as {@link publishedGeneration} reads it
 * off the value's head, or, unless `justAnswer`, when `held` is older than
 * `refreshAfterMs`. A call where nothing was published costs that head's read.
 */
export async function readAgain(held: Help | undefined, root: string, options: { readonly index?: string; readonly justAnswer?: boolean; readonly refreshAfterMs: number }): Promise<boolean> {
  const at = held === undefined ? undefined : workspaceGeneration(held);
  if (at === undefined) return true;
  if (options.justAnswer !== true && Date.now() - Date.parse(at) > options.refreshAfterMs) return true;
  const published = await publishedGeneration(root, options.index ?? sourceIndexPath(realpathSync(resolve(root))));
  return published !== undefined && Date.parse(published) > Date.parse(at);
}

/**
 * Whether the tree published beside the store whose head is `held`, at
 * `index`, opens in this build. A tree of another format version, or one whose
 * bytes moved, is published again rather than kept, though the index it was
 * drawn from did not move. The tree is its own file: the store is not opened.
 */
export async function workspaceTreeOpens(held: StoreHead, index: string): Promise<boolean> {
  try {
    const tree = await readFile(workspaceTreePath(index, held.graphDigest));
    if (hexDigestOf(tree) !== held.graphDigest) return false;
    decodeSourceTree(tree, held.graphRoot, held.root);
    return true;
  } catch {
    return false;
  }
}

/**
 * The digest of the manifest published at `index`. Segments are named by their
 * own digests, so the manifest's bytes are the whole chain's identity. Absent
 * when nothing is published there.
 */
export async function indexManifestDigest(index: string): Promise<string | undefined> {
  const bytes = await readFile(index).catch(() => undefined);
  return bytes === undefined ? undefined : hexDigestOf(bytes);
}

/**
 * Publish a new generation time when its authoritative changed set is empty.
 * Nothing was read for it, so the value keeps the time its read began.
 */
export async function republishWorkspaceSnapshot(help: Help, index: string): Promise<void> {
  const held = snapshots.get(help);
  const bytes = stores.get(help);
  if (held === undefined || bytes === undefined) return;
  const generatedAt = new Date().toISOString();
  try {
    const next = restampHelpStore(bytes, generatedAt);
    await writeReplacing(workspaceSnapshotPath(index), next);
    generated.set(help, generatedAt);
    snapshots.set(help, { ...held, generatedAt });
    stores.set(help, next);
    searches.set(help, openSearchIndex(next));
  } catch {
    // The previously committed generation remains answerable and keeps its time.
  }
}

/** The tree published from `graph`, drawn over `graphRoot` and answered for `root`: the encoded bytes, or the records they encode. */
export function publishedTree(graph: readonly FileRecord[] | Uint8Array, graphRoot: string, root: string): Tree {
  return graph instanceof Uint8Array ? decodeSourceTree(graph, graphRoot, root) : treeAtWorkspace(treeOf(graph, graphRoot), root);
}

/**
 * The value the store `store` holds, published at `index` with the tree
 * `tree` beside it under `graphDigest`: opened first, so it answers whether or
 * not it could be written, then the tree, which a store on disk names, then the
 * store. A tree of that digest and length already there is kept, since its
 * name is its content.
 */
export async function publishStore(index: string, store: Uint8Array, tree: Uint8Array, graphDigest: string): Promise<Help> {
  const opened = openHelpStore(store);
  const { help, generation: held } = opened;
  if (held !== undefined) {
    snapshots.set(help, held);
    generated.set(help, held.generatedAt);
  }
  stores.set(help, store);
  searches.set(help, opened.search);
  try {
    const at = workspaceSnapshotPath(index);
    await mkdir(dirname(at), { recursive: true });
    const graph = workspaceTreePath(index, graphDigest);
    if ((await stat(graph).catch(() => undefined))?.size !== tree.length) await writeReplacing(graph, tree);
    await writeReplacing(at, store);
  } catch {
    // This value is complete. An unwritable cache costs reuse, not this answer.
  }
  return help;
}

/**
 * The search over one Help value, and the rows of it a question names: the
 * one the store it was read from or published to holds, or one encoded in
 * memory, once per value.
 */
export function searchIndexOf(help: Help): SearchIndex {
  let index = searches.get(help);
  if (index === undefined) searches.set(help, (index = openSearchIndex(encodeStore(help).bytes)));
  return index;
}

async function writeReplacing(at: string, bytes: Uint8Array): Promise<void> {
  // Its own name, so two replacements of one path never write the same file.
  const temporary = `${at}.${randomUUID()}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, at);
}

/** Where the graph of one generation is written: beside `index`, under its digest. */
function workspaceTreePath(index: string, graphDigest: string): string {
  return `${index}.help-tree.${graphDigest}.bin`;
}

/**
 * The digest a generation names its tree and its index by: SHA-256 in hex, as
 * the addon names a tree it draws, which no prefixed digest of
 * `@variance-authority/core/format` spells.
 */
export function hexDigestOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
