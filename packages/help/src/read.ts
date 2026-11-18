/**
 * What the repository imports and exports, read from the index the scan keeps.
 *
 * [`use.ts`](https://github.com/Variance-Authority/variance-authority/blob/main/packages/package/src/use.ts) can answer this by itself: walk every
 * directory, parse every module, collect every specifier. On this repository
 * that is 1336 files and about half a second, and the half second is paid again
 * on the next question about the same unchanged checkout. A repository ten times
 * the size — which is an ordinary repository — pays ten times that, every time,
 * to re-learn a tree where almost nothing moved.
 *
 * Nothing about the reading justifies the cost, because the reading is already
 * done. [`sense`](https://github.com/Variance-Authority/variance-authority/tree/main/packages/sense) keeps a durable, content-keyed index of exactly
 * these bytes: git names each file's content without opening it, the digest
 * names what parsing that content produced, and a scan of an unchanged tree
 * costs a map lookup per file. So a read here scans to bring the index up to
 * date, saves it, and reads the value off the saved index in the addon, as
 * `variance index` does: one producer, and no parse row handed to JavaScript.
 *
 * ## Two readings, one index
 *
 * The scan's own question is which files reach which files. This question is
 * which *names* one package takes from another and which names each file hands
 * out, and the specifiers it needs are the same specifiers the scan resolved.
 * Sharing the index means the answer gets faster every time anything else in the
 * toolchain scans — and it means a repository that has never run a selection
 * still pays the full walk exactly once.
 *
 * Both halves of a file's parse are read, not just the requests. The exports are
 * what makes a name findable when no manifest publishes it, which is most of the
 * code in any checkout, and they cost nothing extra: the same cached parse that
 * already said what the file imports also says what it exports.
 */

import { resolve } from 'node:path';
import { type Tree } from '@variance-authority/mcp/tools';
import {
  updateSourceIndex,
  sourceIndexPath,
  stepped,
  type HelpTaint,
  type Progress,
} from '@variance-authority/sense';
import type { Taint } from '@variance-authority/sense/taint';
import {
  readWorkspaceManifests,
  type Help,
  type HelpOptions,
} from '@variance-authority/package/help';
import { operatorError } from './operator.js';
import { publishHelp } from './refresh-native.js';
import { scanScope, scopeSourceIndexPath } from './scan-scope.js';
import {
  publishedTree,
  readWorkspaceSnapshot,
  republishWorkspaceSnapshot,
  workspaceGeneration,
  workspaceReadStarted,
} from './snapshot.js';

export interface ReadingOptions extends HelpOptions, IndexedUsageOptions {}

export interface AnsweringOptions extends ReadingOptions {
  /** Read the published generation regardless of age and perform no refresh. */
  readonly justAnswer?: boolean;
  /** Refresh a published generation older than this. Defaults to one hour. */
  readonly refreshAfterMs?: number;
}

/**
 * A read whose source index could not be saved. A tool reads lines out of the
 * index on disk and names out of the value it was given, so a value of this
 * read would answer with the last read's lines: it is thrown away, and the
 * generation before it stays whole, its value, index and times together.
 */
export class UnsavedRead extends Error {
  /** The reader's to fix, as {@link operatorError} says of any other refusal. */
  readonly varianceOperatorError = true;

  constructor(refused: string) {
    super(`the source index could not be saved: ${refused}`);
    this.name = 'UnsavedRead';
  }
}

/**
 * Answer from the published value while it is young enough, or refresh it when
 * the caller permits. `justAnswer` is the hard no-I/O-beyond-the-artifact path.
 */
export async function readWorkspaceForAnswer(
  root: string,
  options: AnsweringOptions = {},
): Promise<Help> {
  const {
    justAnswer = false,
    refreshAfterMs = 60 * 60 * 1000,
    ...reading
  } = options;
  if (!Number.isFinite(refreshAfterMs) || refreshAfterMs < 0) {
    throw new Error('refreshAfterMs must be a finite, non-negative number');
  }
  if (justAnswer && (reading.changed !== undefined || reading.taints !== undefined)) {
    throw new Error('justAnswer cannot be combined with changed paths or taints, which request a refresh');
  }

  let recorded: Help;
  try {
    recorded = await readWorkspaceSnapshot(root, reading);
  } catch (error) {
    if (justAnswer) {
      throw operatorError(
        `${error instanceof Error ? error.message : String(error)}. ` +
          'Run `variance index`, or ask again without `--just-answer`, to read the checkout and publish one.',
        { cause: error },
      );
    }
    // With nothing to refresh a list is no read: the files it leaves out would come
    // from the index, under a time that says they were read now.
    const { changed: _, ...whole } = reading;
    return readWorkspace(root, whole);
  }

  const at = workspaceGeneration(recorded);
  const age = at === undefined ? Number.POSITIVE_INFINITY : Date.now() - Date.parse(at);
  if (justAnswer || (reading.changed === undefined && reading.taints === undefined && age <= refreshAfterMs)) {
    return recorded;
  }
  if (reading.changed?.length === 0 && reading.taints === undefined) {
    await republishWorkspaceSnapshot(recorded, reading.index ?? sourceIndexPath(resolve(root)));
    return recorded;
  }
  try {
    return await (reading.changed !== undefined || reading.taints !== undefined ? refreshWorkspace(root, recorded, reading) : readWorkspace(root, reading));
  } catch (error) {
    // The read is lost and the generation is whole: the look says what it did not compare. A read asked for now, or for edges only a taint adds, has no such answer.
    if (error instanceof UnsavedRead && refreshAfterMs !== 0 && reading.taints === undefined) return recorded;
    throw error;
  }
}

export interface IndexedUsageOptions {
  /** Where the index is kept. The checkout's own cache layer when absent. */
  readonly index?: string;
  /** Read each file's bytes from Git's object store, as `variance index --no-git` turns off. On when absent. */
  readonly packs?: boolean;
  /**
   * Authoritative changed file paths, relative to the scan root.
   * Present skips Git status discovery; renames name both paths.
   */
  readonly changed?: readonly string[];
  /**
   * Additional declarative module loads to join onto the graph used by path
   * questions.
   *
   * These do not manufacture symbol bindings: usage counts remain facts from
   * ordinary imports inside the files the additional edge makes reachable.
   * Subtractive taints are refused because a mock is relative to one file's
   * run and cannot be flattened into the workspace-wide source tree.
   */
  readonly taints?: readonly Taint[];
  /** Handed the queryable graph when a caller asks a path-shaped question: the tree this reading publishes. */
  readonly tree?: (tree: Tree) => void;
  /** Told each step as it starts and ends: the manifests, the source, the names, the publish. */
  readonly progress?: Progress;
}

/**
 * Update the native source index and publish the workspace's declarations,
 * documentation and usage. Unchanged source is reused without reading or
 * parsing it again. A publication that cannot be saved throws {@link UnsavedRead}.
 */
export async function readWorkspace(root: string, options: ReadingOptions = {}): Promise<Help> {
  return readAndPublish(root, options, new Date().toISOString());
}

/**
 * Read the workspace again over a value published before it.
 *
 * Every read publishes the whole value off the saved index, so `documented`
 * says only when its read began: a refresh of `changed` files read those files
 * and nothing else, so every other file is as old as `documented` read it, and
 * the value keeps that time as `readStartedAt`.
 */
export async function refreshWorkspace(
  root: string,
  documented: Help,
  options: ReadingOptions = {},
): Promise<Help> {
  const kept = options.changed === undefined ? undefined : workspaceReadStarted(documented);
  return readAndPublish(root, options, kept === undefined ? new Date().toISOString() : new Date(kept).toISOString());
}

/** The addition-only rows of `taints`, a file to the specifiers it is said to load; a subtractive row is refused. */
function additionsOf(taints: readonly Taint[]): HelpTaint[] {
  const rows = new Map<string, Set<string>>();
  let shadows = 0;
  for (const taint of taints) {
    for (const [file, diff] of taint.diffs ?? []) {
      if ((diff.minus?.length ?? 0) > 0) shadows += 1;
      const held = rows.get(file) ?? new Set<string>();
      rows.set(file, held);
      for (const value of diff.plus ?? []) held.add(value);
    }
  }
  if (shadows > 0) {
    throw new Error(
      `Help source areas cannot apply subtractive taints: ${shadows} file(s) shadow a module. ` +
      'Pass addition-only taints for declarative module loads.',
    );
  }
  return [...rows].map(([file, plus]) => ({ file, plus: [...plus] }));
}

async function readAndPublish(root: string, options: ReadingOptions, readStartedAt: string): Promise<Help> {
  const where = resolve(root);
  const taints = options.taints === undefined ? undefined : additionsOf(options.taints);
  const { offerings, targets } = await stepped(options.progress, `reading the package manifests of ${where}`, () =>
    readWorkspaceManifests(where, { ...options, tolerant: options.tolerant ?? true }));
  // What `scanScope` names: the workspace's own directory whole, not only its
  // members, since it holds source no `workspaces` entry claims — `tools/`, a
  // scripts directory, a config that imports from a package — and each member
  // it lists outside that directory. Nothing beside what it lists can import
  // from it. The scan declines to descend into a checkout that is not this
  // one, so the root means this repository.
  const scope = scanScope(where, offerings);
  const own = options.index ?? sourceIndexPath(where);
  const at = scopeSourceIndexPath(own, scope.dirs);
  const update = await updateSourceIndex(scope.root, {
    index: at, dirs: scope.dirs,
    ...(options.changed === undefined ? {} : { changed: options.changed }),
    ...(options.packs === undefined ? {} : { packs: options.packs }),
    ...(options.progress === undefined ? {} : { progress: options.progress }),
  });
  if (update.refused !== undefined) throw new UnsavedRead(update.refused);
  const published = await publishHelp({
    workspace: where,
    root: scope.root,
    offerings,
    targets,
    index: at,
    own,
    readStartedAt,
    ...(update.listing === undefined ? {} : { listing: update.listing }),
    ...(update.packs === undefined ? {} : { packs: update.packs }),
    ...(taints === undefined ? {} : { taints }),
    ...(options.progress === undefined ? {} : { progress: options.progress }),
  });
  if (published === undefined) throw new UnsavedRead(`no source index opens at ${at}`);
  options.tree?.(publishedTree(published.tree, scope.root, where));
  return published.help;
}
