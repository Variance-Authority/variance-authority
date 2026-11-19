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
 * mainline's record, and the update that follows reads only the files that
 * differ from it. An index this release wrote is never replaced, and nothing
 * is fetched for one: the update it already has is the cheaper read.
 *
 * The checkout that bumps `variance` before CI has published an index in the
 * new format finds none, and reads every file, as it does without the setting.
 */

import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { digestOfSha256 } from '@variance-authority/core/format';
import type { ShareEntry } from '@variance-authority/core/share';
import type { SourceRestore, SourceRestored } from '@variance-authority/sense';
import type { Config } from '../config.js';
import type { Env } from '../share-lines.js';

type Place = Pick<Config, 'share' | 'cacheRoot'>;

/** The entry's name: one slot, versioned by the index's format, so a reader asks for the format it reads. */
export async function sourceIndexEntryName(): Promise<string> {
  const { SOURCE_INDEX_VERSION } = await import('@variance-authority/sense');
  return `source-index-v${String(SOURCE_INDEX_VERSION)}`;
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
  const segments = new Map<string, Uint8Array>();
  for (const segment of chain.segments) {
    const bytes = await readFile(segment.path);
    segments.set(createHash('sha256').update(bytes).digest('hex'), bytes);
  }
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
      const bytes = segments.get(digest);
      if (bytes === undefined) throw new Error(`the source index names no segment ${digest}`);
      return bytes;
    },
  };
}

/** Fetches started beside a mainline record's read, by checkout, each taken by the update that comes for it. */
const started = new Map<string, Promise<SourceRestored | undefined>>();

/**
 * Start fetching the mainline's index for `root` while its record is read, and
 * do not wait for it: the record is what the caller waits on. The update of
 * the index in this process takes what it placed.
 */
export function startSourceIndexFetch(root: string, place: Place, ask: { readonly env: Env; readonly mainline?: string; readonly base?: string }): void {
  if (place.share?.sourceIndex !== true) return;
  const key = keyOf(root);
  if (started.has(key)) return;
  started.set(key, fetchSourceIndex(root, place, ask).catch(() => undefined));
}

/**
 * {@link SourceRestore} for the checkout's own index: the fetch a record's read
 * started, or one started now when none was.
 */
export const restoreFromMainline: SourceRestore = async (root, path) => {
  const sense = await import('@variance-authority/sense');
  if (path !== sense.sourceIndexPath(root)) return undefined;
  const key = keyOf(root);
  const fetching = started.get(key);
  if (fetching !== undefined) {
    started.delete(key);
    return fetching;
  }
  // Loaded here: every reader of the index imports this, and most never fetch.
  const { selectMainline } = await import('./mainline-selected.js');
  const chosen = await selectMainline(root);
  if ('unconfigured' in chosen || chosen.share?.sourceIndex !== true) return undefined;
  const { share, cacheRoot, named } = chosen;
  const at = named === undefined ? {} : { mainline: named.name, ...(named.base === undefined ? {} : { base: named.base }) };
  return fetchSourceIndex(root, { share, cacheRoot }, { env: process.env, ...at });
};

/**
 * Put the mainline's index at `root` when the one there is another release's.
 * Undefined, with the index as it was, when it is this release's or missing,
 * the share holds none in this release's format, or what it holds does not
 * check out against its own digests.
 */
async function fetchSourceIndex(
  root: string,
  place: Place,
  ask: { readonly env: Env; readonly mainline?: string; readonly base?: string },
): Promise<SourceRestored | undefined> {
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
  const placed = await sense.restoreSourceIndex(path, manifest, async (digest) => {
    const image = images.find((held) => digestOfSha256(held) === digest);
    if (image === undefined) return undefined;
    const bytes = await found.held.image(image);
    return bytes instanceof Uint8Array ? bytes : undefined;
  });
  return placed ? { written, fetched: `${found.at.mainline}'s at ${found.at.commit.slice(0, 12)}` } : undefined;
}

function keyOf(root: string): string {
  try {
    return realpathSync(root);
  } catch {
    return resolve(root);
  }
}
