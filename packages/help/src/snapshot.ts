import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  decodeSourceTree,
  encodeSourceTree,
  type FileRecord,
  type Tree,
} from '@variance-authority/mcp/tools';
import type { Help } from '@variance-authority/package/help';
import { readSourceRecords, sourceIndexPath } from '@variance-authority/sense';
import { encodeSearchIndex, openSearchIndex, type SearchIndex } from './search-index.js';

export interface SnapshotOptions {
  /** The source index this reading was published beside. */
  readonly index?: string;
  /** Handed the recorded graph without consulting the checkout. */
  readonly records?: (records: readonly FileRecord[], graphRoot: string) => void;
  /** Handed the published graph without decoding the source index. */
  readonly tree?: (tree: Tree) => void;
}

const SNAPSHOT_FORMAT = 'variance-authority-help';
const SNAPSHOT_VERSION = 2;

interface WorkspaceSnapshot {
  readonly format: typeof SNAPSHOT_FORMAT;
  readonly version: typeof SNAPSHOT_VERSION;
  readonly root: string;
  /** Repository root every recorded file is relative to. */
  readonly graphRoot: string;
  readonly graphDigest: string;
  readonly generatedAt: string;
  readonly help: Help;
}

const generated = new WeakMap<Help, string>();
const snapshots = new WeakMap<Help, Omit<WorkspaceSnapshot, 'help'>>();
const searches = new WeakMap<Help, SearchIndex>();

/** When the workspace value was published, absent on an unrecorded reading. */
export function workspaceGeneration(help: Help): string | undefined {
  return generated.get(help);
}

/** The answerable workspace value published beside one source-index generation. */
export function workspaceSnapshotPath(index: string): string {
  return `${index}.help.json`;
}

/** Read the last published value without inspecting the checkout or asking Git. */
export async function readWorkspaceSnapshot(
  root: string,
  options: SnapshotOptions = {},
): Promise<Help> {
  const where = realpathSync(resolve(root));
  const index = options.index ?? sourceIndexPath(where);
  const at = workspaceSnapshotPath(index);
  let decoded: unknown;
  try {
    decoded = JSON.parse(await readFile(at, 'utf8'));
  } catch (error) {
    throw new Error(
      `no readable workspace snapshot at ${at}: ${error instanceof Error ? error.message : String(error)}. ` +
        'Refresh the workspace index before asking from recorded state.',
      { cause: error },
    );
  }
  if (!isWorkspaceSnapshot(decoded)) {
    throw new Error(`the workspace snapshot at ${at} is not a ${SNAPSHOT_FORMAT} v${SNAPSHOT_VERSION} value`);
  }
  if (decoded.root !== where) {
    throw new Error(`the workspace snapshot at ${at} belongs to ${decoded.root}, not ${where}`);
  }
  if (options.tree !== undefined) {
    const bytes = await readFile(workspaceTreePath(index, decoded.graphDigest));
    if (digest(bytes) !== decoded.graphDigest) {
      throw new Error(`the workspace source tree beside ${at} does not belong to that generation`);
    }
    options.tree(decodeSourceTree(bytes, decoded.graphRoot, decoded.root));
  }
  if (options.records !== undefined) {
    options.records(await readSourceRecords(index), decoded.graphRoot);
  }
  generated.set(decoded.help, decoded.generatedAt);
  snapshots.set(decoded.help, {
    format: decoded.format,
    version: decoded.version,
    root: decoded.root,
    graphRoot: decoded.graphRoot,
    graphDigest: decoded.graphDigest,
    generatedAt: decoded.generatedAt,
  });
  return decoded.help;
}

/** Publish a new generation time when its authoritative changed set is empty. */
export async function republishWorkspaceSnapshot(help: Help, index: string): Promise<void> {
  const held = snapshots.get(help);
  if (held === undefined) return;
  const generatedAt = new Date().toISOString();
  const next: WorkspaceSnapshot = { ...held, generatedAt, help };
  try {
    const at = workspaceSnapshotPath(index);
    const temporary = `${at}.${String(process.pid)}.tmp`;
    await writeFile(temporary, `${JSON.stringify(next)}\n`, 'utf8');
    await rename(temporary, at);
    generated.set(help, generatedAt);
    snapshots.set(help, { ...held, generatedAt });
    await writeSearch(help, index);
  } catch {
    // The previously committed generation remains answerable and keeps its time.
  }
}

/** Publish one complete answerable value without making publication its success. */
export async function tryPublishWorkspaceSnapshot(
  root: string,
  graphRoot: string,
  help: Help,
  records: readonly FileRecord[],
  index?: string,
): Promise<void> {
  try {
    const at = workspaceSnapshotPath(index ?? sourceIndexPath(root));
    const temporary = `${at}.${String(process.pid)}.tmp`;
    const generatedAt = new Date().toISOString();
    const tree = encodeSourceTree(records);
    const graphDigest = digest(tree);
    const treeAt = workspaceTreePath(index ?? sourceIndexPath(root), graphDigest);
    const treeTemporary = `${treeAt}.${String(process.pid)}.tmp`;
    const snapshot: WorkspaceSnapshot = {
      format: SNAPSHOT_FORMAT,
      version: SNAPSHOT_VERSION,
      root: realpathSync(root),
      graphRoot: realpathSync(graphRoot),
      graphDigest,
      generatedAt,
      help,
    };
    await mkdir(dirname(at), { recursive: true });
    await writeFile(treeTemporary, tree);
    await rename(treeTemporary, treeAt);
    await writeFile(temporary, `${JSON.stringify(snapshot)}\n`, 'utf8');
    await rename(temporary, at);
    generated.set(help, generatedAt);
    snapshots.set(help, {
      format: snapshot.format,
      version: snapshot.version,
      root: snapshot.root,
      graphRoot: snapshot.graphRoot,
      graphDigest: snapshot.graphDigest,
      generatedAt,
    });
    await writeSearch(help, index ?? sourceIndexPath(root));
  } catch {
    // This value is complete. An unwritable cache costs reuse, not this answer.
  }
}

/**
 * The search over one generation, published beside it as its own file.
 *
 * `search` reads names, docs and sites and nothing else, and the value above
 * holds every signature, comment and README mention too. Parsing all of it to
 * answer a substring is the whole cost of the question on a large repository —
 * hundreds of megabytes of JSON for a lookup that touches a few rows — so the
 * search reads a columnar file it opens in place instead. It is written from
 * the same value in the same publication and carries that generation, so the
 * two cannot describe different checkouts under one timestamp.
 */
export function workspaceSearchPath(index: string): string {
  return `${index}.help-search.bin`;
}

/** Read the last published search without inspecting the checkout or asking Git. */
export async function readSearchSnapshot(root: string, index?: string): Promise<SearchIndex> {
  const where = realpathSync(resolve(root));
  const at = workspaceSearchPath(index ?? sourceIndexPath(where));
  const search = openSearchIndex(await readFile(at));
  const root_ = search.generation?.root;
  if (root_ === undefined) throw new Error(`the search at ${at} carries no generation`);
  if (root_ !== where) throw new Error(`the search at ${at} belongs to ${root_}, not ${where}`);
  return search;
}

/** The graph a published search was generated with, read only for a path-shaped question. */
export async function readSearchTree(search: SearchIndex, root: string, index?: string): Promise<Tree> {
  const generation = search.generation;
  if (generation === undefined) throw new Error('a search built in memory has no published graph');
  const bytes = await readFile(workspaceTreePath(index ?? sourceIndexPath(generation.root), generation.graphDigest));
  if (digest(bytes) !== generation.graphDigest) {
    throw new Error(`the workspace source tree for ${root} does not belong to the published search`);
  }
  return decodeSourceTree(bytes, generation.graphRoot, generation.root);
}

/**
 * The search over a value already read, published when it has a generation.
 *
 * A value read from the JSON of an earlier release has no search beside it;
 * this is where that file first appears, so the next question opens it.
 */
export async function searchOf(help: Help, index: string): Promise<SearchIndex> {
  return searches.get(help) ?? (await writeSearch(help, index));
}

async function writeSearch(help: Help, index: string): Promise<SearchIndex> {
  const held = snapshots.get(help);
  const bytes = encodeSearchIndex(
    help,
    held === undefined
      ? undefined
      : { root: held.root, graphRoot: held.graphRoot, graphDigest: held.graphDigest, generatedAt: held.generatedAt },
  );
  const search = openSearchIndex(bytes);
  searches.set(help, search);
  if (held === undefined) return search;
  try {
    const at = workspaceSearchPath(index);
    const temporary = `${at}.${String(process.pid)}.tmp`;
    await writeFile(temporary, bytes);
    await rename(temporary, at);
  } catch {
    // The value answers from memory. An unwritable cache costs the next reading.
  }
  return search;
}

function isWorkspaceSnapshot(value: unknown): value is WorkspaceSnapshot {
  if (value === null || typeof value !== 'object') return false;
  const held = value as Partial<WorkspaceSnapshot>;
  return held.format === SNAPSHOT_FORMAT
    && held.version === SNAPSHOT_VERSION
    && typeof held.root === 'string'
    && typeof held.graphRoot === 'string'
    && typeof held.graphDigest === 'string'
    && typeof held.generatedAt === 'string'
    && Number.isFinite(Date.parse(held.generatedAt))
    && held.help !== null
    && typeof held.help === 'object';
}

function workspaceTreePath(index: string, graphDigest: string): string {
  return `${index}.help-tree.${graphDigest}.bin`;
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
