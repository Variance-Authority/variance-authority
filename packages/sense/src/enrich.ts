import type { Parsed, ParseCache } from './cache.js';
import type { Digest } from './digest.js';
import { keyFor, parseWay } from './files.js';
import { native, nativeRefusal } from './native.js';

export interface HarvestSubject {
  readonly file: string;
  readonly digest: Digest;
}

/** Add declaration facts to selected parse-cache rows without resolving again. */
export async function enrichSources(
  root: string,
  subjects: readonly HarvestSubject[],
  cache: ParseCache,
): Promise<ReadonlyMap<string, Parsed>> {
  const files = subjects.map((subject) => subject.file);
  const found = new Map<string, Parsed>();
  const addon = native();
  if (addon === undefined) {
    throw new Error(`sense: reading declarations needs the native addon, which did not load: ${nativeRefusal()}`);
  }
  if (files.length === 0) return found;
  const batch = addon.readBatch(root, files, undefined, false, 6);
  for (const [index, subject] of subjects.entries()) {
    const encoded = batch.parses[index];
    if (encoded === undefined || encoded === '') continue;
    const parsed = JSON.parse(encoded) as Parsed;
    found.set(subject.file, parsed);
    cache.set(keyFor(subject.digest, parseWay(subject.file)), parsed);
  }
  return found;
}
