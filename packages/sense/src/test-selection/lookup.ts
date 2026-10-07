import type { TestCoverageView } from './format-view.js';

/**
 * Finding one row by path in a snapshot whose rows are code-unit sorted.
 *
 * Both tables are code-unit sorted by `normalize()` in `format.ts` before they
 * are encoded, so a lookup is a binary search over interned strings rather than
 * a decode of the column. The readers in `select.ts` and `importers.ts` ask the
 * same two questions of the same columns, and this is the one place either
 * answer is spelled.
 *
 * The dictionary underneath them is sorted the same way, by both of the things
 * that write one — `dictionary()` in `format.ts` sorts, and
 * `layeredDictionary()` merges two runs that are already in order — so a path
 * can be turned into the integer it was interned under before any column is
 * touched. That is what lets a question about a name be asked in integers.
 *
 * ## Why the searches run in the addon
 *
 * A search reads the path at every row it probes, and every search over one
 * column probes the same rows first: the middle, then a quarter in, and so on.
 * One selection asks a few thousand paths — every name of every changed file,
 * every importer the walks reach, every name the precondition table is asked
 * about. Made in JavaScript, each probe is a string built from the dictionary's
 * bytes to be compared once and dropped.
 *
 * The addon compares the stored UTF-8 against the asked path in place, in the
 * order JavaScript's code units sort, and keeps each run of a column or of the
 * dictionary it decompressed for as long as the view is open
 * ({@link TestCoverageView.lookup}). What crosses back is row numbers, and the
 * strings of the rows a caller is about to report.
 */

/** One module row recorded under exactly this path, if there is one; {@link findModules} has them all. */
export function findModule(coverage: TestCoverageView, file: string): number | undefined {
  return findModules(coverage, file)[0];
}

/**
 * Every module row recorded under exactly this path, in row order.
 *
 * One build reading a path is one row. Two builds reading it — a second
 * environment, a second transform, a layer folded over a run — are two rows
 * under the same path, and the encoder sorts them side by side without merging
 * them. A binary search lands on one of them; the answer is all of them, and
 * a caller that reads one leaves the other's crossings on the floor.
 */
export function findModules(coverage: TestCoverageView, file: string): readonly number[] {
  return coverage.lookup.modules(file);
}

/** The test row recorded under exactly this path, if there is one. */
export function findTest(coverage: TestCoverageView, file: string): number | undefined {
  return coverage.lookup.test(file) ?? undefined;
}

/** The path a test row was recorded under. */
export function testPathOf(coverage: TestCoverageView, test: number): string {
  return testPathsOf(coverage, [test])[0]!;
}

/** The paths these test rows were recorded under, in the order they are asked. */
export function testPathsOf(coverage: TestCoverageView, tests: readonly number[]): readonly string[] {
  return tests.length === 0 ? [] : coverage.lookup.testPaths(Uint32Array.from(tests));
}

/**
 * The id this snapshot interned a string under, if it interned it at all.
 *
 * `undefined` is the useful half. A string the dictionary does not hold cannot
 * be the value of any id column in the file, so a caller that was going to
 * search a column for it already has its answer and can decline to look.
 */
export function findString(coverage: TestCoverageView, value: string): number | undefined {
  return coverage.lookup.interned(value) ?? undefined;
}

/**
 * Tests a changed file governs, and the files nothing in the snapshot answers
 * for.
 *
 * Coverage records where execution *entered* a module, so a file nothing enters
 * has no module row however much it decides. A test file is one: it is its own
 * recorded precondition, and nothing enters it. A declared `preconditions` entry
 * — runner configuration, a fixture, an environment file — is another, and it is
 * every test’s. Read as "no module, no tests", a commit that edits a test
 * selected nothing and the new test never ran; a commit that changed the runner
 * config selected nothing and every test that config governs never ran. Both are
 * silent: the selector returns an empty list and the run is green.
 *
 * A file that is neither is not a file that governs nothing. It is a file the
 * snapshot was never told about, and it is returned as `unread` rather than
 * dropped so a caller can decline to narrow instead of narrowing on a blank.
 *
 * ## Why the names are turned into integers first
 *
 * The precondition table is the largest thing a snapshot holds that is not a
 * crossing: one row per test per precondition, so it grows as the product of
 * the two, and at two thousand tests each declaring a few hundred inputs it is
 * a hundred million rows. Decoding a string per row to compare it against a
 * handful of paths makes the cheapest question in the format — "did anything
 * record this file?" — the most expensive one in it, and pays for the answer in
 * allocation: at that size the decode alone is fourteen seconds and a couple of
 * hundred megabytes of short-lived strings, against three milliseconds for the
 * same question asked about a module.
 *
 * So each wanted path is looked up in the sorted dictionary first, which is
 * about twenty probes apiece, and the scan then compares `u32` to `u32` and
 * decodes nothing. A path the dictionary never interned cannot be anyone's
 * precondition, so when none of them is interned the table is not read at all —
 * which is every diff that touches a document, an asset, or anything else the
 * run never saw.
 */
export function testsGovernedBy(
  coverage: TestCoverageView,
  files: readonly string[],
): { readonly tests: ReadonlyMap<number, readonly string[]>; readonly unread: readonly string[] } {
  if (files.length === 0) return { tests: new Map(), unread: [] };

  const matched = new Set<string>();
  const tests = new Map<number, string[]>();
  for (const { test, files: declared } of coverage.lookup.governed([...files])) {
    const governing = declared.map((at) => files[at]!);
    for (const name of governing) matched.add(name);
    tests.set(test, governing);
  }

  return {
    tests,
    unread: files.filter((file) => !matched.has(file)).sort(codeUnitOrder),
  };
}

/**
 * The preconditions every test in the recording declares, other than its own
 * file: what the harness loads before any test imports anything, such as the
 * runner's config and the local modules it imports.
 *
 * Every test resting on a file is what makes it the harness's rather than one
 * test's, so a name some test does not declare is not in the answer. A
 * recording with no tests has no harness to name.
 */
export function sharedPreconditions(coverage: TestCoverageView): readonly string[] {
  return coverage.lookup.shared();
}

function codeUnitOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
