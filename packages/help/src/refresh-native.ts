import { digestString } from '@variance-authority/core/format';
import { isAbsolute, relative, resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import {
  readHelp,
  sourceIndexPath,
  stepped,
  updateSourceIndex,
  type Progress,
  type PublishedName,
} from '@variance-authority/sense';

import {
  assembleHelp,
  readWorkspaceManifests,
  type DeclarationKind,
  type Help,
  type HelpOptions,
  type ImportTargets,
  type Names,
  type Offering,
  type Reached,
  type Use,
} from '@variance-authority/package/help';
import {
  headGeneration,
  hexDigestOf,
  publishedOverChain,
  publishStore,
  workspaceGeneration,
  workspaceTreeOpens,
} from './snapshot.js';
import type { StoreHead } from './store-layout.js';
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
 * just written, and keep the value published last when that index did not
 * move. The generation published or kept, `undefined` when there is no index
 * to read.
 *
 * The manifests are the costliest read before the index on a workspace that
 * lists thousands of members, so they are read once here.
 */
export async function publishWorkspaceFromIndex(root: string, options: FromIndexOptions): Promise<string | undefined> {
  const where = resolve(root);
  const { offerings, targets } = await stepped(options.progress, `reading the package manifests of ${where}`, () =>
    readWorkspaceManifests(where, { ...options, tolerant: options.tolerant ?? true }));
  const scope = scanScope(where, offerings);
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
  // A value read over every segment the chain names, joined against these manifests, is what this publish would
  // write: an index that did not move costs nothing, while the tree beside it still opens.
  const previous = publishedOverChain(own, index);
  if (
    previous !== undefined && previous.root === realpathSync(where) && samePackages({ root: scope.root, offerings }, previous)
    && await workspaceTreeOpens(previous, own)
  ) return headGeneration(previous, own);
  const help = await publishHelp({
    workspace: where,
    root: scope.root,
    offerings,
    targets,
    index,
    own,
    readStartedAt: options.readStartedAt,
    ...(options.progress === undefined ? {} : { progress: options.progress }),
  });
  return help === undefined ? undefined : workspaceGeneration(help.help);
}

/** What {@link publishHelp} reads and writes. */
export interface HelpPublication {
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
  /** The tree to publish in place of the one the addon draws off the index, such as one a caller's taints joined: what no chain says. */
  readonly tree?: Uint8Array;
  readonly progress?: Progress;
}

/**
 * The one producer of the published value: the chain at `index` read by the
 * addon — the uses, the names each entry hands out and the declarations they
 * are read from, the export list, the imports by path and the tree — joined
 * here with the manifests and the READMEs into the documented surface,
 * encoded, and published in the chain's manifest over the segments the
 * reading read, its tree beside `own`. No parse row crosses into JavaScript.
 * The value as published, and the tree it was published with; `undefined`
 * when no index was published at `index`. Throws with the first export whose
 * declaration the chain cannot say.
 */
export async function publishHelp(publication: HelpPublication): Promise<{ readonly help: Help; readonly tree: Uint8Array } | undefined> {
  const { workspace, root, offerings, targets, index, progress } = publication;
  const sources = offerings.flatMap((offering) => offering.entrypoints.map((entry) => ({ offering, entry })));
  const entries = sources.map(({ offering, entry }) => ({ key: `${offering.name} ${entry.subpath}`, file: pathOf(root, entry.source) }));
  const reading = await stepped(progress, 'reading what each file imports and exports, from the index', () =>
    readHelp(root, entries, targets, index, publication.tree === undefined));
  if (reading === null) return undefined;

  const read = reading.usage();
  const names = new Map<string, Map<string, Use[]>>();
  for (const use of read.names) {
    const held = names.get(use.key) ?? new Map<string, Use[]>();
    names.set(use.key, held);
    const uses = held.get(use.name) ?? [];
    held.set(use.name, uses);
    uses.push(useOf(use));
  }
  const published = reading.names();
  const namesBySource = new Map<string, Names>();
  sources.forEach(({ entry }, at) => namesBySource.set(entry.source, namesOf(published[at]!)));
  // The export list and the imports by path are the reading's, encoded by the addon; the value joined here carries the packages.
  const help = await stepped(progress, 'reading the signatures and comments of the exported names', async () =>
    assembleHelp(root, offerings, { names, deep: [], byPath: [], unfollowed: [], exported: [], unreadable: read.unreadable }, (source) =>
      namesBySource.get(source) ?? new Map()));

  return stepped(progress, 'publishing the questions', async () => {
    const graphDigest = publication.tree === undefined ? undefined : hexDigestOf(publication.tree);
    const encoded = await reading.encode({
      root: realpathSync(workspace),
      graphRoot: realpathSync(root),
      generatedAt: new Date().toISOString(),
      readStartedAt: publication.readStartedAt,
      packagesDigest: packagesDigest(root, offerings),
      packages: storeOf(help).packages,
      unreadable: help.unreadable,
      ...(graphDigest === undefined ? {} : { graphDigest }),
    });
    const tree = publication.tree ?? encoded.tree;
    if (tree === undefined || tree === null) throw new Error('the reading drew no tree, and none was handed to it');
    const place = { chain: index, over: reading.over(), given: publication.tree !== undefined, index: publication.own };
    return { help: await publishStore(place, encoded.store, tree, encoded.graphDigest), tree };
  });
}

/** One entry's names as the documented surface reads them: by name, then by kind. */
function namesOf(published: readonly PublishedName[]): Names {
  return new Map(published.map(({ name, kinds }) => [name, new Map(kinds.map((kind): [DeclarationKind, Reached] => [kind.kind as DeclarationKind, {
    kind: kind.kind as DeclarationKind,
    at: kind.at,
    line: kind.line,
    ...(kind.signature === undefined || kind.signature === null ? {} : { signature: kind.signature }),
    ...(kind.doc === undefined || kind.doc === null ? {} : { doc: kind.doc }),
    declared: kind.declared,
  }]))]));
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

/** Whether the offerings are the ones the value headed `documented` was published from; never for a value published without them. */
export function samePackages(read: { readonly root: string; readonly offerings: readonly Offering[] }, documented: StoreHead): boolean {
  const held = documented.packagesDigest;
  return held !== undefined && held === packagesDigest(read.root, read.offerings);
}
