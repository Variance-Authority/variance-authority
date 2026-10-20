import { digestString } from '../digest.js';
import type { TestCoverageView } from './format-view.js';
import { findString } from './lookup.js';
import { applied, type Hunk } from './patch.js';

/**
 * The changed files no row holds whose text every test declaring them already
 * ran over.
 *
 * A file nothing enters — a test's own file, a setup file — is held, if at all,
 * by the tests that declared it as a precondition, each with the digest of the
 * text it ran over. A diff from the recording's commit names such a file
 * whenever the run was over a dirty tree: the edit the run already took, left
 * in place or committed since. Where every test declaring it recorded the text
 * the diff arrives at, nothing changed for those tests, and nothing else ran
 * the file. Where one recorded another text, the file is not in the answer and
 * every test declaring it is selected, as it was before.
 *
 * Only a file the record interned a name of is read: a name it never interned
 * is nobody's precondition, and reading its text would cost a read for nothing.
 */
export function ranOverFiles(
  coverage: TestCoverageView,
  rowless: Iterable<string>,
  hunks: ReadonlyMap<string, readonly Hunk[]>,
  knownAs: (file: string) => readonly string[],
  sourceAt: ((file: string, commit: string | undefined) => string | undefined) | undefined,
): ReadonlySet<string> {
  if (sourceAt === undefined || coverage.commit === undefined) return new Set();
  const arrived = new Map<string, string>();
  const files: string[] = [];
  for (const file of rowless) {
    if (!declarable(coverage, knownAs(file))) continue;
    // A file the commit does not hold is new, and its diff is its whole text.
    const patched = applied(sourceAt(file, coverage.commit) ?? '', hunks.get(file) ?? []);
    if (patched === undefined) continue;
    const digest = digestString(patched.after);
    for (const name of knownAs(file)) arrived.set(name, digest);
    files.push(file);
  }
  const held = recordedOverText(coverage, arrived);
  return new Set(files.filter((file) => knownAs(file).some((name) => held.ran.has(name)) && !knownAs(file).some((name) => held.moved.has(name))));
}

/** Whether the record interned any of a file's names, which a precondition naming it needs. */
export function declarable(coverage: TestCoverageView, names: readonly string[]): boolean {
  return names.some((name) => findString(coverage, name) !== undefined);
}

/**
 * Which names of `current` the tests holding them ran over: `ran`, where every
 * precondition naming one records the digest `current` gives it, and `moved`,
 * where some precondition records another. A name no test holds is in neither.
 *
 * The digest beside a precondition is the text the test ran over. Compared by
 * id, as `testsGovernedBy` compares names, so the table decodes nothing.
 */
export function recordedOverText(
  coverage: TestCoverageView,
  current: ReadonlyMap<string, string>,
): { readonly ran: ReadonlySet<string>; readonly moved: ReadonlySet<string> } {
  const wanted = new Map<number, { readonly name: string; readonly digest: number | undefined }>();
  for (const [name, digest] of current) {
    const id = findString(coverage, name);
    if (id !== undefined) wanted.set(id, { name, digest: findString(coverage, digest) });
  }
  const held = new Set<string>();
  const moved = new Set<string>();
  if (wanted.size === 0) return { ran: held, moved };
  const named = coverage.preconditionName;
  const digests = coverage.preconditionDigest;
  for (let input = 0; input < named.length; input += 1) {
    const one = wanted.get(named.at(input));
    if (one === undefined) continue;
    held.add(one.name);
    if (digests.at(input) !== one.digest) moved.add(one.name);
  }
  return { ran: new Set([...held].filter((name) => !moved.has(name))), moved };
}
