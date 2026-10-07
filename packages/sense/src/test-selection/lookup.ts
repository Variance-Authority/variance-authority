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
 *
 * ## Why a view keeps what its searches decoded
 *
 * A search decodes the path at every row it probes, and every search over one
 * column probes the same rows first: the middle, then a quarter in, and so on.
 * One selection asks a few thousand paths — every name of every changed file,
 * every importer the walks reach, every name the precondition table is asked
 * about — so decoding each probe afresh decoded the same rows over and over, at
 * three reads of the dictionary's offsets apiece: forty-four thousand decodes
 * in one `variance select` over this repository, for under two thousand
 * distinct rows and strings.
 *
 * So each view keeps the paths its searches decoded, by row, and the strings
 * `findString` decoded, by id, for as long as the view is held. A row is
 * decoded once per view at most, and only a row some search probed: a whole
 * table built up front would decode every row of a recording to answer a diff
 * that names three files, which on a recording of a few hundred thousand
 * modules is more than the searches it replaces.
 */

/** What one view's lookups decoded: a path by its row in each table, a string by its id. */
interface Decoded {
  readonly modules: Map<number, string>;
  readonly tests: Map<number, string>;
  readonly strings: Map<number, string>;
}

const decodedBy = new WeakMap<TestCoverageView, Decoded>();

function decoded(coverage: TestCoverageView): Decoded {
  let found = decodedBy.get(coverage);
  if (found === undefined) {
    found = { modules: new Map(), tests: new Map(), strings: new Map() };
    decodedBy.set(coverage, found);
  }
  return found;
}

/** One module row recorded under exactly this path, if there is one; {@link findModules} has them all. */
export function findModule(coverage: TestCoverageView, file: string): number | undefined {
  return search(coverage, coverage.modulePath, decoded(coverage).modules, file);
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
  const held = decoded(coverage).modules;
  const found = search(coverage, coverage.modulePath, held, file);
  if (found === undefined) return [];
  let first = found;
  while (first > 0 && pathAt(coverage, coverage.modulePath, held, first - 1) === file) first -= 1;
  let end = found + 1;
  while (end < coverage.modulePath.length && pathAt(coverage, coverage.modulePath, held, end) === file) end += 1;
  const rows: number[] = [];
  for (let row = first; row < end; row += 1) rows.push(row);
  return rows;
}

/** The test row recorded under exactly this path, if there is one. */
export function findTest(coverage: TestCoverageView, file: string): number | undefined {
  return search(coverage, coverage.testPath, decoded(coverage).tests, file);
}

/** The path a test row was recorded under, decoded once per view whoever asks for it. */
export function testPathOf(coverage: TestCoverageView, test: number): string {
  return pathAt(coverage, coverage.testPath, decoded(coverage).tests, test);
}

/**
 * The id this snapshot interned a string under, if it interned it at all.
 *
 * `undefined` is the useful half. A string the dictionary does not hold cannot
 * be the value of any id column in the file, so a caller that was going to
 * search a column for it already has its answer and can decline to look.
 */
export function findString(coverage: TestCoverageView, value: string): number | undefined {
  const held = decoded(coverage).strings;
  const string = (at: number): string => {
    let found = held.get(at);
    if (found === undefined) held.set(at, (found = coverage.string(at)));
    return found;
  };
  const id = stringBound(coverage.strings, (at) => codeUnitOrder(string(at), value));
  return id < coverage.strings && string(id) === value ? id : undefined;
}

/**
 * Where a string sorts among a dictionary of `strings` sorted in code-unit
 * order: the first id whose string is not below it, and `strings` when every
 * one is. `order(id)` compares the string at `id` with the one wanted, as
 * `codeUnitOrder` does. A reader that holds the stored bytes compares those, so
 * finding a name decodes nothing; one that reads through a view decodes the
 * strings the search visits.
 */
export function stringBound(strings: number, order: (id: number) => number): number {
  let low = 0;
  let high = strings;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (order(middle) < 0) low = middle + 1;
    else high = middle;
  }
  return low;
}

function search(
  coverage: TestCoverageView,
  column: WordColumn,
  held: Map<number, string>,
  file: string,
): number | undefined {
  let low = 0;
  let high = column.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = pathAt(coverage, column, held, middle);
    if (candidate === file) return middle;
    if (candidate < file) low = middle + 1;
    else high = middle - 1;
  }
  return undefined;
}

function pathAt(coverage: TestCoverageView, column: WordColumn, held: Map<number, string>, row: number): string {
  let path = held.get(row);
  if (path === undefined) {
    path = coverage.string(column.at(row));
    held.set(row, path);
  }
  return path;
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
  const tests = coverage.testPath.length;
  if (tests === 0) return [];
  const counts = new Map<number, number>();
  const preconditions = coverage.testPreconditions;
  const named = coverage.preconditionName;
  let end = preconditions.at(0);
  for (let test = 0; test < tests; test += 1) {
    const start = end;
    end = preconditions.at(test + 1);
    const own = coverage.testPath.at(test);
    for (let input = start; input < end; input += 1) {
      const name = named.at(input);
      if (name !== own) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return [...counts]
    .filter(([, count]) => count === tests)
    .map(([name]) => coverage.string(name))
    .sort(codeUnitOrder);
}

function codeUnitOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
