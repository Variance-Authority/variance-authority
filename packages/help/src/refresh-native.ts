import { resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import {
  primarySourceIndexPath,
  readHelp,
  sourceIndexPath,
  stepped,
  updateSourceIndex,
  type Progress,
} from '@variance-authority/sense';

import {
  readWorkspaceManifests,
  type Deep,
  type Help,
  type HelpOptions,
  type Taken,
  type Usage,
  type Use,
  type WorkspaceManifests,
} from '@variance-authority/package/help';
import { joinUsage, readWorkspaceOver, readWorkspaceSnapshot, samePackages } from './read.js';
import { coversWhole, scanScope, scopeSourceIndexPath } from './scan-scope.js';
import { publishedRows } from './search-index.js';
import { type NativeUsage, useOf } from './native-use.js';
import {
  SNAPSHOT_FORMAT,
  SNAPSHOT_VERSION,
  indexManifestDigest,
  workspaceExportedDigest,
  workspaceGeneration,
  workspaceIndexDigest,
  workspaceSearchPath,
  workspaceSnapshotPath,
  workspaceTreePrefix,
} from './snapshot.js';

// compass: variance-authority.report.agent-surface


/** How a value is published from an index `variance index` wrote a moment before. */
export type FromIndexOptions = HelpOptions & {
  readonly index?: string;
  /** `false` reads the workspace's own index from the working tree, as `variance index --no-git` does. */
  readonly packs?: boolean;
  readonly progress?: Progress;
};

/**
 * Publish the questions about the workspace at `root` from an index that was
 * just written: the value published last refreshed from it, or the workspace
 * read when that value is missing or cannot be refreshed. The generation
 * published, `undefined` when nothing was.
 *
 * Both halves start from the manifests, which on a workspace that lists
 * thousands of members are the costliest read before the index, so they are
 * read once here and handed to whichever half runs.
 */
export async function publishWorkspaceFromIndex(root: string, options: FromIndexOptions = {}): Promise<string | undefined> {
  const where = resolve(root);
  const previous = await stepped(options.progress, 'reading the questions published last', () =>
    readWorkspaceSnapshot(where, options.index === undefined ? {} : { index: options.index }).catch(() => undefined));
  const manifests = await manifestsOf(where, options);
  const refreshed = previous === undefined ? undefined : await refreshOver(where, previous, manifests, options);
  // The index is the caller's, written a moment ago and saved by it.
  return refreshed ?? workspaceGeneration(await readWorkspaceOver(where, manifests, { ...options, saveIndex: false }));
}

function manifestsOf(where: string, options: FromIndexOptions): Promise<WorkspaceManifests> {
  return stepped(options.progress, `reading the package manifests of ${where}`, () =>
    readWorkspaceManifests(where, { ...options, tolerant: options.tolerant ?? true }));
}

/**
 * Refresh a published value from an index that was just written, with the
 * chain read and the value written by the native scanner.
 *
 * The caller says the root's index is current, which is what `variance index`
 * knows and a scan would spend its time re-proving. A workspace whose member
 * list reaches beside its root reads the index it keeps over what the list
 * names, and that one is updated here, since only the list says what it covers. Everything that moved is usage,
 * exports and the graph; the documented surface is kept, exactly as
 * `refreshWorkspace` keeps it. On a large repository the value is mostly its
 * export list, and that list never crosses into JavaScript here: it is compared
 * by digest and written by the addon that read it. So what this answers is the
 * generation it published, not the value, and `undefined` when it cannot
 * refresh: the offerings or the exported set changed, or there is no native
 * scanner. The caller then reads the way
 * it always did.
 *
 * A value refreshed from this very manifest, over the same packages, is the
 * value this refresh would write, so it is kept and its generation answered:
 * an index that did not move costs its value nothing.
 */
async function refreshOver(
  where: string,
  documented: Help,
  { offerings, targets }: WorkspaceManifests,
  options: FromIndexOptions,
): Promise<string | undefined> {
  const scope = scanScope(where, offerings);
  if (!samePackages({ root: scope.root, offerings }, documented)) return undefined;
  const opened = offerings.flatMap((offering) => offering.entrypoints.map((entry) => `${offering.name} ${entry.subpath}`));
  const own = options.index ?? sourceIndexPath(where);
  const index = scopeSourceIndexPath(own, scope.dirs);
  if (!coversWhole(scope.dirs)) {
    // A worktree's starts from the primary checkout's, as the root's own does.
    const primary = own === sourceIndexPath(where) ? primarySourceIndexPath(where) : undefined;
    await updateSourceIndex(scope.root, {
      index,
      dirs: scope.dirs,
      ...(primary === undefined ? {} : { primary: scopeSourceIndexPath(primary, scope.dirs) }),
      ...(options.packs === undefined ? {} : { packs: options.packs }),
      ...(options.progress === undefined ? {} : { progress: options.progress }),
    });
  }
  const indexDigest = await indexManifestDigest(index);
  if (indexDigest === undefined) return undefined;
  const kept = workspaceGeneration(documented);
  if (kept !== undefined && workspaceIndexDigest(documented) === indexDigest) return kept;
  let reading: Awaited<ReturnType<typeof readHelp>>;
  try {
    reading = await stepped(options.progress, 'reading what each file imports and exports, from the index', () =>
      readHelp(scope.root, opened, targets, index));
  } catch {
    return undefined;
  }
  if (reading === null || reading.exportedDigest !== workspaceExportedDigest(documented)) return undefined;
  const read = reading.usage();

  const names = new Map<string, Map<string, Use[]>>();
  for (const use of read.names) {
    const held = names.get(use.key) ?? new Map<string, Use[]>();
    names.set(use.key, held);
    const uses = held.get(use.name) ?? [];
    held.set(use.name, uses);
    uses.push(useOf(use));
  }
  // The export list is the reading's; the value joined here carries none of it.
  const usage: Usage = {
    names,
    deep: read.deep.map(byPathOf),
    byPath: read.byPath.map(byPathOf),
    unfollowed: read.unfollowed.map(byPathOf),
    exported: [],
    unreadable: read.unreadable,
  };
  const help: Help = joinUsage(documented, offerings, usage);
  const generatedAt = new Date().toISOString();
  try {
    await stepped(options.progress, 'publishing the questions', () => reading.publish({
      snapshot: workspaceSnapshotPath(own),
      search: workspaceSearchPath(own),
      graph: workspaceTreePrefix(own),
      format: SNAPSHOT_FORMAT,
      version: SNAPSHOT_VERSION,
      root: realpathSync(where),
      graphRoot: realpathSync(scope.root),
      generatedAt,
      indexDigest,
      packages: JSON.stringify(help.packages),
      deep: JSON.stringify(help.deep),
      byPath: JSON.stringify(help.byPath),
      unfollowed: JSON.stringify(help.unfollowed),
      unreadable: JSON.stringify(help.unreadable),
      published: publishedRows(help),
    }));
  } catch {
    // The value is complete. An unwritable cache costs reuse, and the caller reads it back.
  }
  return generatedAt;
}

/** An import by path as the addon hands it over. */
function byPathOf(held: NativeUsage['deep'][number]): Deep {
  const names: Taken[] = held.names.map((use) => ({ name: use.name, ...useOf(use) }));
  return {
    specifier: held.specifier, by: held.by, at: held.at, line: held.line,
    ...(held.to === undefined || held.to === null ? {} : { to: held.to }),
    names,
  };
}
