import { native, nativeRefusal } from './addon.js';
import type { Digest } from './digest.js';

/**
 * Each file's text digest, keyed by the path as given, each file read once.
 *
 * What a run's record names every test file and precondition by. A run hands
 * the whole set at once: a precondition every test file shares is one read,
 * not one per test file, and the addon reads them in parallel.
 */
export function textDigests(paths: Iterable<string>): ReadonlyMap<string, Digest> {
  const unique = [...new Set(paths)];
  const addon = native();
  if (addon?.textDigests === undefined) {
    throw new Error(`a run's preconditions are digested by the native addon, ${nativeRefusal() ?? 'which has no `textDigests`; build it again'}`);
  }
  const digests = addon.textDigests(unique);
  return new Map(unique.map((path, at) => [path, digests[at] as Digest]));
}
