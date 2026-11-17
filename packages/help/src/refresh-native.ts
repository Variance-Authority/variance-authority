import { digestString } from '@variance-authority/core/format';
import { isAbsolute, relative, resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import {
  readHelp,
  sourceIndexPath,
  stepped,
  updateSourceIndex,
  type Progress,
  type SourceUpdate,
} from '@variance-authority/sense';

import {
  readWorkspaceManifests,
  type Help,
  type HelpOptions,
  type ImportTargets,
  type Offering,
} from '@variance-authority/package/help';
import {
  hexDigestOf,
  indexManifestDigest,
  publishStore,
  readWorkspaceSnapshot,
  workspaceGeneration,
  workspaceIndexDigest,
  workspacePackagesDigest,
  workspaceTreeOpens,
} from './snapshot.js';
import { coversWhole, scanScope, scopeSourceIndexPath } from './scan-scope.js';

// compass: variance-authority.report.agent-surface


/** How a value is published from an index `variance index` wrote a moment before. */
export type FromIndexOptions = HelpOptions & {
  readonly index?: string;
  /** `false` reads the workspace's own index from the working tree, as `variance index --no-git` does. */
  readonly packs?: boolean;
  /** The namespace for `root` and eligible configuration bytes the index update already read. */
  readonly listing?: NonNullable<SourceUpdate['listing']>;
  readonly progress?: Progress;
  /** When the update of that index began reading the checkout: the read this publish rests on is the caller's. */
  readonly readStartedAt: string;
};

/**
 * Publish the questions about the workspace at `root` from an index that was
 * just written, and keep the value published last when that index did not
 * move. The generation published or kept, `undefined` when there is no index
 * to read.
 *
 * The manifests are the costliest read before the index on a workspace that
 * lists thousands of members, so they are read once here.
 */
export async function publishWorkspaceFromIndex(root: string, options: FromIndexOptions): Promise<string | undefined> {
  const where = resolve(root);
  const previous = await stepped(options.progress, 'reading the questions published last', () =>
    readWorkspaceSnapshot(where, options.index === undefined ? {} : { index: options.index }).catch(() => undefined));
  const { offerings, targets } = await stepped(options.progress, `reading the package manifests of ${where}`, () =>
    readWorkspaceManifests(where, { ...options, tolerant: options.tolerant ?? true }));
  const scope = scanScope(where, offerings);
  const own = options.index ?? sourceIndexPath(where);
  const index = scopeSourceIndexPath(own, scope.dirs);
  let scanned: Pick<FromIndexOptions, 'listing' | 'packs'> = options;
  // A member list reaching beside the root keeps its own index, which only the list can update.
  if (!coversWhole(scope.dirs)) {
    scanned = await updateSourceIndex(scope.root, {
      index,
      dirs: scope.dirs,
      ...(options.packs === undefined ? {} : { packs: options.packs }),
      ...(options.progress === undefined ? {} : { progress: options.progress }),
    });
  }
  const indexDigest = await indexManifestDigest(index);
  if (indexDigest === undefined) return undefined;
  const kept = previous === undefined ? undefined : workspaceGeneration(previous);
  // A value published from this very manifest over these manifests is what this publish would write: an index that did
  // not move costs nothing, while the tree beside it still opens.
  if (
    previous !== undefined && kept !== undefined && samePackages({ root: scope.root, offerings }, previous)
    && workspaceIndexDigest(previous) === indexDigest && await workspaceTreeOpens(previous, own)
  ) return kept;
  const help = await publishHelp({
    workspace: where,
    root: scope.root,
    offerings,
    targets,
    index,
    own,
    readStartedAt: options.readStartedAt,
    ...(scanned.listing === undefined ? {} : { listing: scanned.listing }),
    ...(scanned.packs === undefined ? {} : { packs: scanned.packs }),
    ...(options.progress === undefined ? {} : { progress: options.progress }),
  });
  return help === undefined ? undefined : workspaceGeneration(help.help);
}

/** What {@link publishHelp} reads and writes. */
export interface HelpPublication extends Pick<FromIndexOptions, 'listing' | 'packs'> {
  /** The workspace the value answers about. */
  readonly workspace: string;
  /** The repository root whose graph carries that workspace: what every recorded path is relative to. */
  readonly root: string;
  readonly offerings: readonly Offering[];
  readonly targets: ImportTargets;
  /** The index the value is read from: the workspace's own, or the scope's beside it. */
  readonly index: string;
  /** The workspace's own index, beside which the value is published. */
  readonly own: string;
  readonly readStartedAt: string;
  /** The tree to publish in place of the one the addon draws off the index, such as one a caller's taints joined. */
  readonly tree?: Uint8Array;
  readonly progress?: Progress;
}

/**
 * The one producer of the published value: the chain at `index` read by the
 * addon — the uses, the names each entry hands out and the declarations they
 * are read from, the export list, the imports by path and the tree — joined
 * here with the manifests and the READMEs into the documented surface,
 * encoded, and published beside `own`. No parse row crosses into JavaScript.
 * The value as published, and the tree it was published with; `undefined`
 * when no index was published at `index`. Throws with the first export whose
 * declaration the chain cannot say.
 */
export async function publishHelp(publication: HelpPublication): Promise<{ readonly help: Help; readonly tree: Uint8Array } | undefined> {
  const { workspace, root, offerings, targets, index, progress } = publication;
  // The manifest the value is read from names it, so the next index over the same manifest writes nothing; a tree handed
  // in, such as one a caller's taints joined, holds what no manifest says.
  const indexDigest = publication.tree === undefined ? await indexManifestDigest(index) : undefined;
  const sources = offerings.flatMap((offering) => offering.entrypoints.map((entry) => ({ offering, entry })));
  const entries = sources.map(({ offering, entry }) => ({ key: `${offering.name} ${entry.subpath}`, file: pathOf(root, entry.source) }));
  const reading = await stepped(progress, 'reading what each file imports and exports, from the index', () =>
    readHelp(root, entries, targets, index, publication.tree === undefined, publication));
  if (reading === null) return undefined;

  return stepped(progress, 'publishing the questions', async () => {
    const timing = process.env.VARIANCE_SENSE_TIMINGS === '1' ? progress : undefined;
    const input = await stepped(timing, 'preparing the questions for encoding', () => {
      const graphDigest = publication.tree === undefined ? undefined : hexDigestOf(publication.tree);
      return {
        root: realpathSync(workspace),
        graphRoot: realpathSync(root),
        generatedAt: new Date().toISOString(),
        readStartedAt: publication.readStartedAt,
        ...(indexDigest === undefined ? {} : { indexDigest }),
        packagesDigest: packagesDigest(root, offerings),
        packages: offerings.map((offering) => ({
          name: offering.name,
          entry: offering.entry,
          openings: offering.entrypoints.map((entry) => ({ subpath: entry.subpath, source: relative(root, entry.source) })),
        })),
        unreadable: offerings.flatMap((offering) => offering.unreadable ?? []),
        ...(graphDigest === undefined ? {} : { graphDigest }),
      };
    });
    const encoded = await stepped(timing, 'encoding the questions', () => reading.encode(input));
    return stepped(timing, 'validating and writing the questions', async () => {
      const tree = publication.tree ?? encoded.tree;
      if (tree === undefined || tree === null) throw new Error('the reading drew no tree, and none was handed to it');
      return { help: await publishStore(publication.own, encoded.store, tree, encoded.graphDigest), tree };
    });
  });
}

/** An entry's file as the index records it: relative to `root`, through any link on the way. */
function pathOf(root: string, file: string): string {
  if (!isAbsolute(file)) return file;
  try {
    return relative(root, realpathSync(file));
  } catch {
    return relative(root, file);
  }
}

/**
 * The offerings a value is documented from, as a digest: names, declarations,
 * whether each declares an entry, and openings. The store keeps it in its head,
 * so a refresh compares manifests without keeping them.
 */
export function packagesDigest(root: string, offerings: readonly Offering[]): string {
  const shape = offerings.map((offering) => ({
    name: offering.name,
    declared: offering.declared,
    entry: offering.entry,
    openings: offering.entrypoints.map((entry) => ({
      subpath: entry.subpath,
      source: relative(root, entry.source),
    })),
  }));
  return digestString(JSON.stringify(shape));
}

/** Whether the offerings are the ones `documented` was published from; never for a value published without them. */
export function samePackages(read: { readonly root: string; readonly offerings: readonly Offering[] }, documented: Help): boolean {
  const held = workspacePackagesDigest(documented);
  return held !== undefined && held === packagesDigest(read.root, read.offerings);
}
