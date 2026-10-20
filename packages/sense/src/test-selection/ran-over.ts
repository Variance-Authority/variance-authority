import { digestString } from '../digest.js';
import type { TestCoverageView } from './format-view.js';
import type { GovernedTests } from './importers.js';
import { findString } from './lookup.js';
import { applied, type Hunk } from './patch.js';

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
    if (!declarable(coverage, knownAs(file))) continue;
    // A file the commit does not hold is new, and its diff is its whole text.
    const patched = applied(sourceAt(file, coverage.commit) ?? '', hunks.get(file) ?? []);
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
export function ranOverAll(names: readonly string[], governed: GovernedTests): boolean {
  const held = names.filter((name) => !governed.unread.includes(name));
  return held.length > 0 && held.every((name) => governed.ranOver.has(name));
}
