import { statSync } from 'node:fs';
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

/**
 * The paths whose text was written after a run began, at `startedAt` from
 * `Date.now()`, or that are gone.
 *
 * {@link textDigests} reads a run's preconditions when the run ends, and a test
 * reads them while it runs. A file written in between is digested at a text
 * its test may never have run, which would read as ran over. Asked after the
 * digests are read, so a write that lands during the read is counted too. A
 * write in the run's first millisecond is not: no test has read a file yet by
 * then, so it runs the text written.
 */
// FIXME: a write time is as fine as the file system keeps it. On one that
// keeps whole seconds (HFS+, FAT, some network mounts), or whose clock runs
// behind the process's, a write early in the run is stamped at or before
// `startedAt` and reads as ran over. Digesting each text as its test starts
// and comparing it here would not depend on the clock.
export function movedSince(paths: Iterable<string>, startedAt: number): ReadonlySet<string> {
  const moved = new Set<string>();
  for (const path of new Set(paths)) {
    const written = statSync(path, { throwIfNoEntry: false })?.mtimeMs;
    if (written === undefined || Math.floor(written) > startedAt) moved.add(path);
  }
  return moved;
}
