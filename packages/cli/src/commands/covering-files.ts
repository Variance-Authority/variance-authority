/**
 * The cases that reached a line, gathered by the test file that declares them.
 *
 * On a base module the list is hundreds of test files and thousands of cases,
 * and a flat list of names answers nothing at that size. The reader's next
 * move is to open a test file, so the answer is one row per file: how many of
 * its cases went through the line, out of how many the record holds for it,
 * and how far the file sits from the one asked about. `9/20` says the file
 * tests this line on purpose in some cases and passes through it in others;
 * `20/20` says every case needs it.
 *
 * The total is every case the record holds for the file, read from the whole
 * index even when `--cases` cut the answer to part of it: a file's size is a
 * property of the file, not of the question.
 */

import type { CoveringTest, ExecutionIndex } from '@variance-authority/sense/test-selection';

/** One test file among the cases that reached a line or function. */
export interface CoveringFile {
  readonly file: string;
  /** How many of its cases called into the line or function. */
  readonly cases: number;
  /** How many cases the record holds for this file. */
  readonly of: number;
  /**
   * Import hops from the file asked about to this test file, under `--hops`.
   * Absent when not asked, and when the walk could not place the file: an
   * unmeasured distance is not a short one.
   */
  readonly hops?: number;
}

/**
 * One row per test file, nearest first.
 *
 * A case that only loaded the module is not counted: it was there because the
 * module evaluated for it, not because it called in, and counting it would
 * read every importer of a module as a test of its top level.
 */
export function coveringFiles(
  tests: readonly CoveringTest[],
  whole: ExecutionIndex,
  hops?: ReadonlyMap<string, number | undefined>,
): readonly CoveringFile[] {
  const cases = new Map<string, number>();
  for (const test of tests) {
    if (test.loaded === true) continue;
    cases.set(test.file, (cases.get(test.file) ?? 0) + 1);
  }
  const of = new Map<string, number>();
  for (const test of whole.tests) {
    if (cases.has(test.file)) of.set(test.file, (of.get(test.file) ?? 0) + 1);
  }
  // TODO: group by the suite's declared nature (unit, browser, visual) once a
  // record names its suite — spec 0062; one record holds one suite today.
  return [...cases]
    .map(([file, count]) => {
      const distance = hops?.get(file);
      return { file, cases: count, of: of.get(file) ?? count, ...(distance === undefined ? {} : { hops: distance }) };
    })
    .sort(nearestFirst);
}

function nearestFirst(left: CoveringFile, right: CoveringFile): number {
  if (left.hops !== right.hops) {
    if (left.hops === undefined) return 1;
    if (right.hops === undefined) return -1;
    return left.hops - right.hops;
  }
  if (left.cases !== right.cases) return right.cases - left.cases;
  return left.file < right.file ? -1 : left.file > right.file ? 1 : 0;
}
