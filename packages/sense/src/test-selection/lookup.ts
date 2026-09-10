import type { TestCoverageView } from './format.js';

/**
 * Finding one row by path in a snapshot whose rows are code-unit sorted.
 *
 * Both tables are code-unit sorted by `normalize()` in `format.ts` before they
 * are encoded, so a lookup is a binary search over interned strings rather than
 * a decode of the column. The readers in `select.ts` and `importers.ts` ask the
 * same two questions of the same columns, and this is the one place either
 * answer is spelled.
 */

/** The module row recorded under exactly this path, if there is one. */
export function findModule(coverage: TestCoverageView, file: string): number | undefined {
  return search(coverage, coverage.modulePath, file);
}

/** The test row recorded under exactly this path, if there is one. */
export function findTest(coverage: TestCoverageView, file: string): number | undefined {
  return search(coverage, coverage.testPath, file);
}

function search(coverage: TestCoverageView, column: Uint32Array, file: string): number | undefined {
  let low = 0;
  let high = column.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = coverage.string(column[middle]!);
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
 */
export function testsGovernedBy(
  coverage: TestCoverageView,
  files: readonly string[],
): { readonly tests: ReadonlyMap<number, readonly string[]>; readonly unread: readonly string[] } {
  if (files.length === 0) return { tests: new Map(), unread: [] };
  const wanted = new Set(files);
  const matched = new Set<string>();
  const tests = new Map<number, string[]>();

  for (let test = 0; test < coverage.testPath.length; test += 1) {
    for (
      let input = coverage.testPreconditions[test]!;
      input < coverage.testPreconditions[test + 1]!;
      input += 1
    ) {
      const name = coverage.string(coverage.preconditionName[input]!);
      if (!wanted.has(name)) continue;
      matched.add(name);
      tests.set(test, [...(tests.get(test) ?? []), name]);
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
