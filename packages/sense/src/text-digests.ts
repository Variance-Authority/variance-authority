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
 * The test files written after a run began, at `startedAt` from `Date.now()`,
 * and the declared files written since the process started, or gone.
 *
 * A runner reads a test file in the run that runs it, but a file it loads once
 * — its configuration, what that imports — it reads before any run announces
 * itself and keeps for every run after, so only the process's start bounds it.
 * A precondition does not say which kind it is, so every one is judged so.
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
// `startedAt` and reads as ran over. So does a copy that keeps the source's
// write time (`cp -p`, `rsync -t`, an unpacked archive). Digesting each text as
// its test starts and comparing it here would not depend on the clock.
function movedSince(
  tests: Iterable<string>,
  startedAt: number,
  declared: Iterable<string>,
): ReadonlySet<string> {
  const moved = new Set<string>();
  const since = (paths: Iterable<string>, start: number): void => {
    for (const path of new Set(paths)) {
      const written = statSync(path, { throwIfNoEntry: false })?.mtimeMs;
      if (written === undefined || Math.floor(written) > start) moved.add(path);
    }
  };
  since(tests, startedAt);
  since(declared, Math.floor(performance.timeOrigin));
  return moved;
}

/** What a run's record rests on: each text's digest, and which test files rest on a text that moved. */
export interface RunTexts {
  readonly digests: ReadonlyMap<string, Digest>;
  /** Whether a test file, or a precondition it declared, was written while it ran: see {@link movedSince}. */
  moved(test: string, governing: readonly string[]): boolean;
}

/**
 * The texts a run's test files and their preconditions rest on, each read once:
 * a precondition every test file shares is one read, not one per test file. A
 * test file whose text, or a declared precondition's, moved while it ran is
 * digested at a text it may not have run, and its fold records it incomplete.
 */
export function runTexts(files: readonly { test: string; governing: readonly string[] }[], startedAt: number): RunTexts {
  const digests = textDigests(files.flatMap(({ test, governing }) => [test, ...governing]));
  const moved = movedSince(files.map(({ test }) => test), startedAt, files.flatMap(({ governing }) => governing));
  return { digests, moved: (test, governing) => moved.has(test) || governing.some((path) => moved.has(path)) };
}
