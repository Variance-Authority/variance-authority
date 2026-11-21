// compass: variance-authority.reach
/**
 * The source index CI built, carried beside the mainline's record, for a
 * repository that opted in with `share.sourceIndex`.
 *
 * A release that changes the index's format makes the next update on every
 * checkout read every file, and in a large repository that is minutes. CI pays
 * it once on the mainline anyway, so `share --suite` publishes that index on
 * the mainline as one more entry, its segments cut into pieces that are the
 * entry's images. The share stores an image once, so a commit sends only the
 * pieces no commit before it sent: the segments its update wrote. An update
 * over an index another release wrote fetches it as it starts, places it beside
 * its own, starts from it as it starts from another checkout's, and reads only
 * the files that differ; the mainline's record never waits on it, and an update
 * that finds another checkout's index of this release drops it unawaited. Nothing is fetched for an
 * index this release wrote: the update it already has is the cheaper read.
 *
 * The checkout that bumps `variance` before CI has published an index in the
 * new format finds none, and reads every file, as it does without the setting.
 */

import type { ShareEntry } from '@variance-authority/core/share';
import type { SourceFetch } from '@variance-authority/sense';
import { sourceIndexEntry } from '../share-entries.js';

/** The entry this release's index is published and fetched under. */
async function sourceIndexEntryName(): Promise<string> {
  const { SOURCE_INDEX_VERSION } = await import('@variance-authority/sense');
  return sourceIndexEntry(SOURCE_INDEX_VERSION);
}

/**
 * The index at `root` as an entry at `commit`, its pieces its images, and the
 * bytes of one image when the share asks for it; or why it is not published.
 * `piece` is the most bytes one image holds.
 */
export async function sourceIndexEntryOf(
  root: string,
  at: { readonly commit: string; readonly head?: string },
  piece?: number,
): Promise<{ readonly entry: ShareEntry; readonly image: (digest: string) => Promise<Uint8Array> } | { readonly unpublished: string }> {
  const sense = await import('@variance-authority/sense');
  const path = sense.sourceIndexPath(root);
  const chain = await sense.sourceIndexChain(path);
  const written = chain === undefined ? undefined : await sense.sourceIndexWrittenIn(path);
  if (chain === undefined || written === undefined) return { unpublished: `this checkout has no source index at ${path} that reads` };
  if (written !== sense.SOURCE_INDEX_VERSION) {
    return { unpublished: `the source index at ${path} was written in format version ${String(written)}, and this release writes ${String(sense.SOURCE_INDEX_VERSION)}` };
  }
  const carried = await sense.carriedSourceIndex(chain, piece);
  const entry: ShareEntry = {
    name: await sourceIndexEntryName(),
    commit: at.commit,
    ...(at.head === undefined ? {} : { head: at.head }),
    images: [...carried.pieces],
    bytes: carried.bytes,
  };
  return { entry, image: carried.piece };
}

/**
 * {@link SourceFetch}: places the mainline's index at `into` and says whose it
 * is. The update asks it only over an index another release wrote, as it
 * starts, so it runs while the checkout is listed, and a command that does not
 * update the index never starts it. Undefined, with nothing placed and git not
 * asked, when the repository did not opt in. An opted-in repository is told on
 * stderr that the download starts, and why nothing was placed when the share
 * holds no index in this release's format, cannot be read, or holds one that
 * does not check out against its digests. Once `signal` aborts, another
 * checkout's index fits: it reads no further piece, places nothing, and says
 * nothing more.
 */
export const fetchFromMainline: SourceFetch = async (root, into, signal) => {
  // Loaded here: every reader of the index imports this, and the update asks only over another release's.
  const { rootShare } = await import('./mainline-selected.js');
  const { cacheRootFor, rootConfig } = await import('@variance-authority/sense/test-selection');
  // The opt-in first: a repository that did not opt in asks git nothing, and a share section that does not parse opts in to nothing.
  let share: ReturnType<typeof rootShare>;
  try {
    share = rootShare(rootConfig(root));
  } catch {
    return undefined;
  }
  if (share?.sourceIndex !== true) return undefined;
  const missed = (why: string): undefined => {
    process.stderr.write(`variance: CI's source index was not fetched, so every file is read: ${why}\n`);
    return undefined;
  };
  try {
    const { readerMainline } = await import('../share-lines.js');
    const chosen = await readerMainline({ share }, process.env, root);
    const named = 'missing' in chosen ? undefined : chosen;
    const { mainlineEntry } = await import('./mainline-entry.js');
    const name = await sourceIndexEntryName();
    const found = await mainlineEntry({ share, cacheRoot: cacheRootFor(root) }, name, {
      env: process.env,
      cwd: root,
      ...(named === undefined ? {} : { mainline: named.name, ...(named.base === undefined ? {} : { base: named.base }) }),
    });
    signal.throwIfAborted();
    if ('miss' in found) {
      return missed(`the share holds no ${name} (${'detail' in found.miss ? `${found.miss.kind}: ${found.miss.detail}` : found.miss.kind})`);
    }
    const whose = `${found.at.mainline}'s at ${found.at.commit.slice(0, 12)}`;
    process.stderr.write(`variance: fetching ${whose} source index, since this checkout's was written by another release\n`);
    const carried = await found.held.bytes();
    if (!(carried instanceof Uint8Array)) return missed(`the manifest of ${whose} did not read`);
    const images = new Set(found.held.entry.images ?? []);
    const { placeSourceIndex } = await import('@variance-authority/sense');
    const placed = await placeSourceIndex(into, carried, async (digest) => {
      signal.throwIfAborted();
      if (!images.has(digest)) return undefined;
      const bytes = await found.held.image(digest);
      return bytes instanceof Uint8Array ? bytes : undefined;
    });
    return placed ? whose : missed(`a segment of ${whose} is missing or not what its digest says`);
  } catch (error) {
    if (signal.aborted) return undefined;
    return missed(error instanceof Error ? error.message : String(error));
  }
};
