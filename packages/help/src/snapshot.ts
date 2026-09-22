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
  } catch {
    // This value is complete. An unwritable cache costs reuse, not this answer.
  }
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
