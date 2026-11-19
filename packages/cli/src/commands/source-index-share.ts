// compass: variance-authority.reach
/**
 * The source index CI built, carried beside the mainline's record, for a
 * repository that opted in with `share.sourceIndex`.
 *
 * A release that changes the index's format makes the next update on every
 * checkout read every file, and in a large repository that is minutes. CI pays
 * it once on the mainline anyway, so `share --suite` publishes that index on
 * the mainline as one more entry, its segments as the entry's images. An
 * update over an index another release wrote fetches it as it starts, places
 * it beside its own, starts from it as it starts from another checkout's, and
 * reads only the files that differ; the mainline's record never waits on it. Nothing is fetched for an index this release wrote: the
 * update it already has is the cheaper read.
 *
 * The checkout that bumps `variance` before CI has published an index in the
 * new format finds none, and reads every file, as it does without the setting.
 */

import { readFile, stat } from 'node:fs/promises';
import { digestOfSha256 } from '@variance-authority/core/format';
import { entryDigest, type ShareEntry } from '@variance-authority/core/share';
import type { SourceFetch } from '@variance-authority/sense';
import { sourceIndexEntry } from '../share-entries.js';

/** The largest file `readFile` reads whole. */
const READABLE = 2 ** 31 - 1;

/** The entry this release's index is published and fetched under. */
async function sourceIndexEntryName(): Promise<string> {
  const { SOURCE_INDEX_VERSION } = await import('@variance-authority/sense');
  return sourceIndexEntry(SOURCE_INDEX_VERSION);
}

/** The index at `root` as an entry at `commit`, and its segments by image digest; or why it is not published. */
export async function sourceIndexEntryOf(
  root: string,
  at: { readonly commit: string; readonly head?: string },
): Promise<{ readonly entry: ShareEntry; readonly image: (digest: string) => Promise<Uint8Array> } | { readonly unpublished: string }> {
  const sense = await import('@variance-authority/sense');
  const path = sense.sourceIndexPath(root);
  const written = await sense.sourceIndexWrittenIn(path);
  if (written === undefined) return { unpublished: `this checkout has no source index at ${path}` };
  if (written !== sense.SOURCE_INDEX_VERSION) {
    return { unpublished: `the source index at ${path} was written in format version ${String(written)}, and this release writes ${String(sense.SOURCE_INDEX_VERSION)}` };
  }
  const chain = await sense.sourceIndexChain(path);
  if (chain === undefined) return { unpublished: `the source index at ${path} does not read` };
  // An image is carried whole, and Node reads no file past 2 GiB whole: such a segment is named, not thrown.
  for (const segment of chain.segments) {
    const { size } = await stat(segment.path);
    if (size > READABLE) return { unpublished: `its segment ${segment.path} is ${String(size)} bytes, past the ${String(READABLE)} one image can carry` };
  }
  // By file, read again when the share asks: it asks only for the segments the line does not hold yet.
  const segments = new Map<string, string>();
  for (const segment of chain.segments) segments.set(entryDigest(await readFile(segment.path)), segment.path);
  const entry: ShareEntry = {
    name: await sourceIndexEntryName(),
    commit: at.commit,
    ...(at.head === undefined ? {} : { head: at.head }),
    images: [...segments.keys()],
    bytes: chain.manifest,
  };
  return {
    entry,
    image: async (digest) => {
      const file = segments.get(digest);
      if (file === undefined) throw new Error(`the source index names no segment ${digest}`);
      return readFile(file);
    },
  };
}

/**
 * {@link SourceFetch} for the checkout's own index: places the mainline's index
 * beside it and says whose it is. The update asks it only over an index another
 * release wrote, as it starts, so it runs while the checkout is listed, and a
 * command that does not update the index never starts it. Undefined, with
 * nothing placed and git not asked, when the repository did not opt in. An
 * opted-in repository is told on stderr that the download starts, and why
 * nothing was placed when the share holds no index in this release's format,
 * cannot be read, or holds one that does not check out against its digests.
 */
export const fetchFromMainline: SourceFetch = async (root, into) => {
  const sense = await import('@variance-authority/sense');
  if (into !== sense.fetchedSourceIndexPath(sense.sourceIndexPath(root))) return undefined;
  // Loaded here: every reader of the index imports this, and the update asks only over another release's.
  const { rootShare, selectMainline } = await import('./mainline-selected.js');
  const { rootConfig } = await import('@variance-authority/sense/test-selection');
  // The opt-in first: a repository that did not opt in asks git nothing.
  try {
    if (rootShare(rootConfig(root))?.sourceIndex !== true) return undefined;
  } catch {
    return undefined;
  }
  const missed = (why: string): undefined => {
    process.stderr.write(`variance: CI's source index was not fetched, so every file is read: ${why}\n`);
    return undefined;
  };
  try {
    const chosen = await selectMainline(root);
    if ('unconfigured' in chosen) return missed(chosen.unconfigured);
    const { share, cacheRoot, named } = chosen;
    if (share === undefined) return missed('the configuration names no share');
    const { mainlineEntry } = await import('./mainline-entry.js');
    const name = await sourceIndexEntryName();
    const found = await mainlineEntry({ share, cacheRoot }, name, {
      env: process.env,
      cwd: root,
      ...(named === undefined ? {} : { mainline: named.name, ...(named.base === undefined ? {} : { base: named.base }) }),
    });
    if ('miss' in found) {
      return missed(`the share holds no ${name} (${'detail' in found.miss ? `${found.miss.kind}: ${found.miss.detail}` : found.miss.kind})`);
    }
    const whose = `${found.at.mainline}'s at ${found.at.commit.slice(0, 12)}`;
    process.stderr.write(`variance: fetching ${whose} source index, since this checkout's was written by another release\n`);
    const manifest = await found.held.bytes();
    if (!(manifest instanceof Uint8Array)) return missed(`the manifest of ${whose} did not read`);
    const images = found.held.entry.images ?? [];
    const placed = await sense.placeSourceIndex(into, manifest, async (digest) => {
      const image = images.find((held) => digestOfSha256(held) === digest);
      if (image === undefined) return undefined;
      const bytes = await found.held.image(image);
      return bytes instanceof Uint8Array ? bytes : undefined;
    });
    return placed ? whose : missed(`a segment of ${whose} is missing or not what its digest says`);
  } catch (error) {
    return missed(error instanceof Error ? error.message : String(error));
  }
};
