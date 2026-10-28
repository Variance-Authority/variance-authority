// compass: variance-authority.reach

import { digestString } from '../digest.js';
import type { TestCoverageView } from './format-view.js';
import { commitFrame } from './frame.js';
import { findString } from './lookup.js';
import { applied, hunksFor, type Hunk } from './patch.js';
import type { FileReading } from './reading.js';

/**
 * The digest of the text each changed file no row holds arrives at, by every
 * name of it.
 *
 * A file nothing enters — a test's own file, a setup file — is held, if at all,
 * by the tests that declared it as a precondition, each with the digest of the
 * text it ran over. A diff from the recording's commit names such a file
 * whenever the run was over a dirty tree: the edit the run already took, left
 * in place or committed since. The precondition scan compares each test's row
 * with these digests (`testsGovernedBy`), so a test that ran the text there now
 * is not selected for it, and one that ran another is.
 *
 * Only a file the record interned a name of is read: a name it never interned
 * is nobody's precondition, and reading its text would cost a read for nothing.
 */
export function arrivedDigests(
  coverage: TestCoverageView,
  rowless: Iterable<string>,
  hunks: ReadonlyMap<string, readonly Hunk[]>,
  knownAs: (file: string) => readonly string[],
  sourceAt: ((file: string, commit: string | undefined) => string | undefined) | undefined,
): ReadonlyMap<string, string> {
  const arrived = new Map<string, string>();
  if (sourceAt === undefined || coverage.commit === undefined) return arrived;
  for (const file of rowless) {
    // Lines with no hunks arrive at no text a test could have run.
    const own = hunksFor(hunks, file);
    if (own === undefined || !declarable(coverage, knownAs(file))) continue;
    const patched = applied(commitFrame(coverage, knownAs(file), file, sourceAt).text, own);
    if (patched === undefined) continue;
    const digest = digestString(patched.after);
    for (const name of knownAs(file)) arrived.set(name, digest);
  }
  return arrived;
}

/** Whether the record interned any of a file's names, which a precondition naming it needs. */
export function declarable(coverage: TestCoverageView, names: readonly string[]): boolean {
  return names.some((name) => findString(coverage, name) !== undefined);
}

/**
 * Whether every test declaring a file under any of its names ran the text it
 * arrives at: some name was held, and each held name only by such tests.
 */
export function ranOverAll(names: readonly string[], unread: ReadonlySet<string>, ranOver: ReadonlySet<string>): boolean {
  const held = names.filter((name) => !unread.has(name));
  return held.length > 0 && held.every((name) => ranOver.has(name));
}

/** The reading of a file whose text the record was taken over. */
export function ranOverReading(file: string): FileReading {
  return { file, verdict: 'none', names: [], kept: true };
}

/** The readings with each ran-over file's in its place, and one for a ran-over file nothing read. */
export function withRanOver(readings: readonly FileReading[], ranOver: ReadonlySet<string>): FileReading[] {
  const read = new Set(readings.map((reading) => reading.file));
  return [
    ...readings.map((reading) => (ranOver.has(reading.file) ? ranOverReading(reading.file) : reading)),
    ...[...ranOver].filter((file) => !read.has(file)).map(ranOverReading),
  ];
}
