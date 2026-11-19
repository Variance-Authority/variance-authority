// compass: variance-authority.reach
/**
 * The source index CI built, carried beside the mainline's record, for a
 * repository that opted in with `share.sourceIndex`.
 *
 * A release that changes the index's format makes the next update on every
 * checkout read every file, and in a large repository that is minutes. CI pays
 * it once on the mainline anyway, so `share --suite` publishes that index on
 * the mainline as one more entry, its segments as the entry's images. A
 * checkout whose index another release wrote fetches it while it fetches the
 * mainline's record and places it beside its own; the update that follows
 * starts from it, as it starts from another checkout's, and reads only the
 * files that differ. Nothing is fetched for an index this release wrote: the
 * update it already has is the cheaper read.
 *
 * The checkout that bumps `variance` before CI has published an index in the
 * new format finds none, and reads every file, as it does without the setting.
 */

import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { digestOfSha256 } from '@variance-authority/core/format';
import { entryDigest, type ShareEntry } from '@variance-authority/core/share';
import type { SourceFetch } from '@variance-authority/sense';
import type { Config } from '../config.js';
import { sourceIndexEntry } from '../share-entries.js';
import type { Env } from '../share-lines.js';

type Place = Pick<Config, 'share' | 'cacheRoot'>;

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
 * Fetches a mainline record's read started, by checkout, each taken by the
 * update that comes for it in this process. A command that never updates the
 * index leaves the placed index beside its own, and the next update fetches
 * again over it.
 */
const started = new Map<string, Promise<string | undefined>>();

/**
 * Start fetching the mainline's index for `root` while its record is read, and
 * do not wait for it: the record is what the caller waits on.
 */
export function startSourceIndexFetch(root: string, place: Place, ask: { readonly env: Env; readonly mainline?: string; readonly base?: string }): void {
  if (place.share?.sourceIndex !== true) return;
  const key = keyOf(root);
  if (started.has(key)) return;
  started.set(key, fetchSourceIndex(root, place, ask).catch(() => undefined));
}

/**
 * {@link SourceFetch} for the checkout's own index: the fetch a record's read
 * started, or one started now when none was.
 */
export const fetchFromMainline: SourceFetch = async (root, into) => {
  const sense = await import('@variance-authority/sense');
  if (into !== sense.fetchedSourceIndexPath(sense.sourceIndexPath(root))) return undefined;
  const key = keyOf(root);
  const fetching = started.get(key);
  if (fetching !== undefined) {
    started.delete(key);
    return fetching;
  }
  // Loaded here: every reader of the index imports this, and the update asks only over another release's.
  const { selectMainline } = await import('./mainline-selected.js');
  const chosen = await selectMainline(root);
  if ('unconfigured' in chosen || chosen.share?.sourceIndex !== true) return undefined;
  const { share, cacheRoot, named } = chosen;
  const at = named === undefined ? {} : { mainline: named.name, ...(named.base === undefined ? {} : { base: named.base }) };
  return fetchSourceIndex(root, { share, cacheRoot }, { env: process.env, ...at });
};

/**
 * Place the mainline's index beside the one at `root` when that one is another
 * release's, and say whose it is. Undefined, with nothing placed, when it is
 * this release's or missing, the share holds none in this release's format, or
 * what it holds does not check out against its own digests.
 */
async function fetchSourceIndex(
  root: string,
  place: Place,
  ask: { readonly env: Env; readonly mainline?: string; readonly base?: string },
): Promise<string | undefined> {
  if (place.share?.sourceIndex !== true) return undefined;
  const sense = await import('@variance-authority/sense');
  const path = sense.sourceIndexPath(root);
  const written = await sense.sourceIndexWrittenIn(path);
  if (written === undefined || written === sense.SOURCE_INDEX_VERSION) return undefined;
  const { mainlineEntry } = await import('./mainline-entry.js');
  const found = await mainlineEntry(place, await sourceIndexEntryName(), {
    env: ask.env,
    cwd: root,
    ...(ask.mainline === undefined ? {} : { mainline: ask.mainline }),
    ...(ask.base === undefined ? {} : { base: ask.base }),
  });
  if ('miss' in found) return undefined;
  const manifest = await found.held.bytes();
  if (!(manifest instanceof Uint8Array)) return undefined;
  const images = found.held.entry.images ?? [];
  const placed = await sense.placeSourceIndex(sense.fetchedSourceIndexPath(path), manifest, async (digest) => {
    const image = images.find((held) => digestOfSha256(held) === digest);
    if (image === undefined) return undefined;
    const bytes = await found.held.image(image);
    return bytes instanceof Uint8Array ? bytes : undefined;
  });
  return placed ? `${found.at.mainline}'s at ${found.at.commit.slice(0, 12)}` : undefined;
}

function keyOf(root: string): string {
  try {
    return realpathSync(root);
  } catch {
    return resolve(root);
  }
}
