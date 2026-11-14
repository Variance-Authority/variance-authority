import { resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import {
  forwardsDigest,
  readHelp,
  sourceIndexPath,
  stepped,
  updateSourceIndex,
  type Progress,
} from '@variance-authority/sense';

import {
  everyEntry,
  readWorkspaceManifests,
  type Help,
  type HelpOptions,
  type Usage,
  type Use,
  type WorkspaceManifests,
} from '@variance-authority/package/help';
import { joinUsage, packagesDigest, readWorkspaceOver, sameExportedSurface, samePackages } from './read.js';
import {
  indexManifestDigest,
  readWorkspaceSnapshot,
  workspaceExportedDigest,
  workspaceForwardsDigest,
  workspaceGeneration,
  workspaceIndexDigest,
  workspaceSnapshotPath,
  workspaceTreePrefix,
} from './snapshot.js';
import { coversWhole, scanScope, scopeSourceIndexPath } from './scan-scope.js';
import { storeOf } from './store-encode.js';
import { useOf } from './native-use.js';

// compass: variance-authority.report.agent-surface


/** How a value is published from an index `variance index` wrote a moment before. */
export type FromIndexOptions = HelpOptions & {
  readonly index?: string;
  /** `false` reads the workspace's own index from the working tree, as `variance index --no-git` does. */
  readonly packs?: boolean;
  readonly progress?: Progress;
  /** When the update of that index began reading the checkout: the read this publish rests on is the caller's. */
  readonly readStartedAt: string;
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
export async function publishWorkspaceFromIndex(root: string, options: FromIndexOptions): Promise<string | undefined> {
  const where = resolve(root);
  const previous = await stepped(options.progress, 'reading the questions published last', () =>
    readWorkspaceSnapshot(where, options.index === undefined ? {} : { index: options.index }).catch(() => undefined));
  const manifests = await manifestsOf(where, options);
  const refreshed = previous === undefined ? undefined : await refreshOver(where, previous, manifests, options);
  // The index is the caller's, written a moment ago and saved by it.
  return refreshed ?? workspaceGeneration(await readWorkspaceOver(where, manifests, options.readStartedAt, { ...options, saveIndex: false }));
}

function manifestsOf(where: string, options: FromIndexOptions): Promise<WorkspaceManifests> {
  return stepped(options.progress, `reading the package manifests of ${where}`, () =>
    readWorkspaceManifests(where, { ...options, tolerant: options.tolerant ?? true }));
}

/**
 * Refresh a published value from an index that was just written, which the
 * caller says is current, with the chain read and the value written by the
 * native scanner, keeping the documented surface as `refreshWorkspace` does.
 *
 * The export list never crosses into JavaScript: it is compared by digest and
 * written by the addon, and only the rows of files an entry prints cross. So
 * this answers the generation it published, not the value, and `undefined` when
 * it cannot refresh: the offerings, the exported set, an `export … from` or a
 * row an entry prints changed, or there is no native scanner.
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
  // A member list reaching beside the root keeps its own index, which only the list can update.
  if (!coversWhole(scope.dirs)) {
    await updateSourceIndex(scope.root, {
      index,
      dirs: scope.dirs,
      ...(options.packs === undefined ? {} : { packs: options.packs }),
      ...(options.progress === undefined ? {} : { progress: options.progress }),
    });
  }
  const indexDigest = await indexManifestDigest(index);
  if (indexDigest === undefined) return undefined;
  const kept = workspaceGeneration(documented);
  // A value refreshed from this very manifest is what this refresh would write: an index that did not move costs nothing.
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
  const forwards = forwardsDigest(read.forwards);
  if (forwards !== workspaceForwardsDigest(documented)) return undefined;
  const printed = [...new Set([...everyEntry(documented)].map(([, , entry]) => entry.at))];
  if (!sameExportedSurface(printed, reading.exportedOf(printed), documented)) return undefined;

  const names = new Map<string, Map<string, Use[]>>();
  for (const use of read.names) {
    const held = names.get(use.key) ?? new Map<string, Use[]>();
    names.set(use.key, held);
    const uses = held.get(use.name) ?? [];
    held.set(use.name, uses);
    uses.push(useOf(use));
  }
  // The export list and the imports by path are the reading's, written by the addon; the value joined here carries the packages.
  const usage: Usage = { names, deep: [], byPath: [], unfollowed: [], exported: [], unreadable: read.unreadable };
  const help: Help = joinUsage(documented, offerings, usage);
  const generatedAt = new Date().toISOString();
  try {
    await stepped(options.progress, 'publishing the questions', () => reading.publish({
      snapshot: workspaceSnapshotPath(own),
      graph: workspaceTreePrefix(own),
      root: realpathSync(where),
      graphRoot: realpathSync(scope.root),
      generatedAt,
      readStartedAt: options.readStartedAt,
      indexDigest,
      forwardsDigest: forwards,
      packagesDigest: packagesDigest(scope.root, offerings),
      packages: storeOf(help).packages,
      unreadable: help.unreadable,
    }));
  } catch {
    // The value is complete. An unwritable cache costs reuse, and the caller reads it back.
  }
  return generatedAt;
}
