import { createHash, randomUUID } from 'node:crypto';
import { closeSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import { mkdir, readFile, rename, stat, utimes, writeFile } from 'node:fs/promises';
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
import { publishedQuestions, publishQuestions, readSourceRecords, sourceIndexPath, type PublishedQuestions } from '@variance-authority/sense';
import { sourceIndexesOf } from './scan-scope.js';
import { openHelpStore, openSearchIndex, type SearchIndex } from './search-index.js';
import { encodeStore } from './store-encode.js';
import { storeHeadOf, type StoreHead } from './store-layout.js';

export interface SnapshotOptions {
  /** The workspace's own source index, in whose chain, or the scope's beside it, the value was published. */
  readonly index?: string;
  /** Handed the recorded graph without consulting the checkout. */
  readonly records?: (records: readonly FileRecord[], graphRoot: string) => void;
  /** Handed the published graph without decoding the source index. */
  readonly tree?: (tree: Tree) => void;
}

const generated = new WeakMap<Help, string>();
const snapshots = new WeakMap<Help, StoreHead>();
const searches = new WeakMap<Help, SearchIndex>();

/**
 * When the workspace value was published, or last compared with the checkout
 * and found unchanged, whichever is later; absent on an unrecorded reading.
 */
export function workspaceGeneration(help: Help): string | undefined {
  return generated.get(help);
}

/** When the read behind the workspace value began, in milliseconds, absent on an unrecorded reading. */
export function workspaceReadStarted(help: Help): number | undefined {
  const held = snapshots.get(help);
  return held === undefined ? undefined : Date.parse(held.readStartedAt);
}

/**
 * The answerable workspace value published for the workspace whose own index
 * is `index`: one binary store holding the packages, the imports by path, the
 * export list and the search over them, with the generation in its head,
 * named in the manifest of the chain it was read from — the workspace's own,
 * or the scope's beside it, whichever published later — over the segments it
 * read. `undefined` when neither names one.
 */
function publishedStore(index: string): PublishedQuestions | undefined {
  const found = sourceIndexesOf(index).flatMap((chain) => publishedQuestions(chain) ?? []);
  if (found.length < 2) return found[0];
  const made = (held: PublishedQuestions): number => Date.parse(headAt(held.at)?.generatedAt ?? '') || 0;
  return found.reduce((newer, held) => made(held) > made(newer) ? held : newer);
}

/**
 * The file the store published for the workspace whose own index is `index`
 * is held in, as {@link readWorkspaceSnapshot} opens it; `undefined` when none
 * is published.
 */
export function publishedStorePath(index: string): string | undefined {
  return publishedStore(index)?.at;
}

/** A refusal for a workspace nothing is published for, which a caller tells from a store that did not open by its `code`. */
function noneAt(index: string): Error {
  return new Error(`no readable workspace snapshot in the source index at ${index}: none is published there`, {
    cause: Object.assign(new Error('none is published'), { code: 'ENOENT' }),
  });
}

/**
 * Beside the value published at `index`, a file of no bytes whose time says when
 * the checkout was last compared with that value. Every publication dates it to
 * the value's `generatedAt`, so a comparison of the value before it no longer
 * counts; an answer told nothing changed dates it now. Every reader of when a
 * value was made, {@link workspaceGeneration} and {@link publishedGeneration},
 * takes the later of its time and the head's, so a comparison costs no byte of
 * the value. Not the index manifest's time: other writers append to the chain.
 */
export function workspaceComparedPath(index: string): string {
  return `${index}.compared`;
}

/** The head's `generatedAt`, or the stamp's time beside `index` when that is later. */
function generationOf(head: StoreHead, index: string): string {
  let compared: number;
  try {
    // Whole milliseconds, as the head dates a value: a coarser filesystem rounds down, never ahead.
    compared = Math.floor(statSync(workspaceComparedPath(index)).mtimeMs);
  } catch {
    return head.generatedAt;
  }
  return compared > Date.parse(head.generatedAt) ? new Date(compared).toISOString() : head.generatedAt;
}

/** Date the stamp beside `index`, making it when it is not there. */
async function stamp(index: string, at: Date): Promise<void> {
  const path = workspaceComparedPath(index);
  await utimes(path, at, at).catch(async () => {
    await writeFile(path, new Uint8Array());
    await utimes(path, at, at);
  });
}

/**
 * Date the stamp beside a value just published at `index` to its `generatedAt`.
 * A publisher that writes the store itself calls this after it; one that fails
 * leaves the value dated by its head, and the stamp by an older comparison.
 */
export async function stampPublished(index: string, generatedAt: string): Promise<void> {
  await stamp(index, new Date(generatedAt)).catch(() => undefined);
}

/** Read the last published value without inspecting the checkout or asking Git. */
export async function readWorkspaceSnapshot(
  root: string,
  options: SnapshotOptions = {},
): Promise<Help> {
  const where = realpathSync(resolve(root));
  const index = options.index ?? sourceIndexPath(where);
  const published = publishedStore(index);
  if (published === undefined) throw noneAt(index);
  const { at } = published;
  let opened: ReturnType<typeof openHelpStore>;
  try {
    const bytes = await readFile(at);
    if (bytes.length !== published.length) throw new Error(`it holds ${String(bytes.length)} bytes, and the manifest names ${String(published.length)}`);
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
  generated.set(help, generationOf(held, index));
  snapshots.set(help, held);
  searches.set(help, opened.search);
  return help;
}

/**
 * The generation published for the workspace whose own index is `index`, read
 * off the store's head alone: the rest is every export of the repository, and
 * a caller asking whether its write landed has no use for it. Absent when there
 * is none, or it is not this format.
 */
export function publishedHead(index: string): StoreHead | undefined {
  const published = publishedStore(index);
  return published === undefined ? undefined : headAt(published.at);
}

/** The head of the store at `at`, read off its first bytes. */
function headAt(at: string): StoreHead | undefined {
  let file: number;
  try {
    file = openSync(at, 'r');
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
 * When the value at `index` was published or last compared, as {@link publishedHead}
 * and the stamp beside it read it. Absent when there is no value, or it belongs to
 * another checkout or format.
 */
export async function publishedGeneration(root: string, index: string): Promise<string | undefined> {
  const where = realpathSync(resolve(root));
  const held = publishedHead(index);
  return held?.root === where ? generationOf(held, index) : undefined;
}

/**
 * Whether a server holding `held` reads the workspace again before it answers:
 * when it holds none, when a generation newer than `held` was published or
 * compared since — `variance index`, or another reader — as {@link publishedGeneration}
 * reads it off the value's head and stamp, or, unless `justAnswer`, when `held` is
 * older than `refreshAfterMs`. A call where nothing was published costs those reads.
 */
export async function readAgain(held: Help | undefined, root: string, options: { readonly index?: string; readonly justAnswer?: boolean; readonly refreshAfterMs: number }): Promise<boolean> {
  const at = held === undefined ? undefined : workspaceGeneration(held);
  if (at === undefined) return true;
  if (options.justAnswer !== true && Date.now() - Date.parse(at) > options.refreshAfterMs) return true;
  const published = await publishedGeneration(root, options.index ?? sourceIndexPath(realpathSync(resolve(root))));
  return published !== undefined && Date.parse(published) > Date.parse(at);
}

/**
 * The generation published in the chain at `chain` for the workspace whose own
 * index is `index`, when it is the one readers take and it was read over the
 * segments the chain names now with nothing a caller handed it: the value a
 * publish from that chain would write again. Read off the manifest and the
 * store's head alone.
 */
export function publishedOverChain(index: string, chain: string): StoreHead | undefined {
  const published = publishedStore(index);
  if (published === undefined || published.given || published.at !== publishedQuestions(chain)?.at) return undefined;
  const { over, segments } = published;
  return over.length === segments.length && over.every((digest, at) => digest === segments[at]) ? headAt(published.at) : undefined;
}

/** When `head`, published for the workspace whose own index is `index`, was made or last compared. */
export function headGeneration(head: StoreHead, index: string): string {
  return generationOf(head, index);
}

/**
 * Whether the tree published with `held` beside `index` opens in this build. A
 * tree of another format version, or one whose bytes moved, is published
 * again rather than kept, though the index it was drawn from did not move.
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
 * Date `help`, read at `index`, as compared with the checkout now, when its
 * authoritative changed set is empty: nothing was read for it, so it keeps the
 * time its read began, and no byte of it is written, only the stamp's time.
 * When another value was published at `index` since `help` was read, the stamp
 * is that value's, and is left as it is.
 */
export async function compareWorkspaceSnapshot(help: Help, index: string): Promise<void> {
  const held = snapshots.get(help);
  const head = publishedHead(index);
  if (held === undefined || head?.generatedAt !== held.generatedAt || head.graphDigest !== held.graphDigest) return;
  try {
    await stamp(index, new Date());
    generated.set(help, generationOf(held, index));
  } catch {
    // The value remains answerable and keeps the time it was last compared.
  }
}

/** The tree published from `graph`, drawn over `graphRoot` and answered for `root`: the encoded bytes, or the records they encode. */
export function publishedTree(graph: readonly FileRecord[] | Uint8Array, graphRoot: string, root: string): Tree {
  return graph instanceof Uint8Array ? decodeSourceTree(graph, graphRoot, root) : treeAtWorkspace(treeOf(graph, graphRoot), root);
}

/** Where {@link publishStore} publishes a store. */
export interface StorePlace {
  /** The chain the store was read from, in whose manifest it is published. */
  readonly chain: string;
  /** The digests of the segments of `chain` it was read over. */
  readonly over: readonly string[];
  /** Whether it holds what no chain says, such as a caller's taints. */
  readonly given: boolean;
  /** The workspace's own index, beside which the tree is written and the stamp dated. */
  readonly index: string;
}

/**
 * The value the store `store` holds, published in the manifest of the chain
 * it was read from with the tree `tree` beside the workspace's own index under
 * `graphDigest`: opened first, so it answers whether or not it could be
 * written, then the tree, which a store on disk names, then the store. A tree
 * of that digest and length already there is kept, since its name is its
 * content.
 */
export async function publishStore(place: StorePlace, store: Uint8Array, tree: Uint8Array, graphDigest: string): Promise<Help> {
  const { index } = place;
  const opened = openHelpStore(store);
  const { help, generation: held } = opened;
  if (held !== undefined) {
    snapshots.set(help, held);
    generated.set(help, held.generatedAt);
  }
  searches.set(help, opened.search);
  try {
    await mkdir(dirname(index), { recursive: true });
    const graph = workspaceTreePath(index, graphDigest);
    if ((await stat(graph).catch(() => undefined))?.size !== tree.length) await writeReplacing(graph, tree);
    const published = await publishQuestions(place.chain, store, place.over, place.given);
    if (published && held !== undefined) await stampPublished(index, held.generatedAt);
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
