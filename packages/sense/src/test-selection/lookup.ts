import type { WordColumn } from './columns.js';
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
 */

/** One module row recorded under exactly this path, if there is one; {@link findModules} has them all. */
export function findModule(coverage: TestCoverageView, file: string): number | undefined {
  return search(coverage, coverage.modulePath, file);
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
  const found = search(coverage, coverage.modulePath, file);
  if (found === undefined) return [];
  let first = found;
  while (first > 0 && coverage.string(coverage.modulePath.at(first - 1)) === file) first -= 1;
  let end = found + 1;
  while (end < coverage.modulePath.length && coverage.string(coverage.modulePath.at(end)) === file) end += 1;
  const rows: number[] = [];
  for (let row = first; row < end; row += 1) rows.push(row);
  return rows;
}

/** The test row recorded under exactly this path, if there is one. */
export function findTest(coverage: TestCoverageView, file: string): number | undefined {
  return search(coverage, coverage.testPath, file);
}

/**
 * The id this snapshot interned a string under, if it interned it at all.
 *
 * `undefined` is the useful half. A string the dictionary does not hold cannot
 * be the value of any id column in the file, so a caller that was going to
 * search a column for it already has its answer and can decline to look.
 */
export function findString(coverage: TestCoverageView, value: string): number | undefined {
  let low = 0;
  let high = coverage.strings - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = coverage.string(middle);
    if (candidate === value) return middle;
    if (candidate < value) low = middle + 1;
    else high = middle - 1;
  }
  return undefined;
}

function search(coverage: TestCoverageView, column: WordColumn, file: string): number | undefined {
  let low = 0;
  let high = column.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = coverage.string(column.at(middle));
    if (candidate === file) return middle;
    if (candidate < file) low = middle + 1;
    else high = middle - 1;
  }
  return undefined;
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
 * about twenty decodes apiece, and the scan then compares `u32` to `u32` and
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

  const wanted = new Map<number, string>();
  for (const file of files) {
    const id = findString(coverage, file);
    if (id !== undefined) wanted.set(id, file);
  }
  if (wanted.size === 0) return { tests: new Map(), unread: [...files].sort(codeUnitOrder) };

  const matched = new Set<string>();
  const tests = new Map<number, string[]>();
  const preconditions = coverage.testPreconditions;
  const named = coverage.preconditionName;

  // The offsets are a CSR: one test's end is the next one's start, so the
  // column is read once per test rather than twice per row.
  let end = preconditions.at(0);
  for (let test = 0; test < coverage.testPath.length; test += 1) {
    const start = end;
    end = preconditions.at(test + 1);
    let governing: string[] | undefined;
    for (let input = start; input < end; input += 1) {
      const name = wanted.get(named.at(input));
      if (name === undefined) continue;
      matched.add(name);
      if (governing === undefined) {
        governing = [];
        tests.set(test, governing);
      }
      governing.push(name);
    }
  }

  return {
    tests,
    unread: files.filter((file) => !matched.has(file)).sort(codeUnitOrder),
  };
}

function codeUnitOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
