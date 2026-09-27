/**
 * Which recorded tests a duration question is about: the ones declared under a
 * path, and the ones the recording says entered a path.
 *
 * Both halves are answered by the record that holds them, never by a second
 * reading of the source. A test file's place is its own path. Which test files
 * entered a module is the snapshot's region-to-tests direction, asked through
 * `testsReachingFromView`, the reader `variance covering` shares; which cases
 * did is `coveringTestsInFile`, the reader `variance covering --file` shares.
 * No import is walked: a test that reached a module through a chain of imports
 * without running any of it did not enter it, and the question is what ran.
 *
 * A path the record holds no row for is unrecorded, which is a different
 * answer from a row nobody entered, and it is kept apart so the reader can say
 * which of the two it is.
 */

// compass: variance-authority.reach

import { testsReachingFromView } from './test-selection/at-source.js';
import type { TestCoverageView } from './test-selection/format-view.js';
import { coveringTestsInFile, type ExecutionIndex } from './test-selection/reverse.js';

/** Where a duration question looks. Each list is repo-relative paths; a directory takes everything under it. */
export interface DurationScope {
  /** Only tests declared in a file at or under one of these paths. */
  readonly from?: readonly string[];
  /** Only tests the recording says entered code at or under one of these paths. */
  readonly to?: readonly string[];
}

/** What a scope matched in one record, by the record's own test numbers. */
export interface ScopeReading {
  /** Declared under a `from` path; every test when there is no `from`. */
  readonly declared: (test: number) => boolean;
  /** Entered a `to` path; every test when there is no `to`. */
  readonly entered: (test: number) => boolean;
  /** `to` paths the record holds no row at or under: unrecorded, not unentered. */
  readonly unrecorded: readonly string[];
}

/** How many tests each half of a scope matched on its own, for a reader to say which half matched nothing. */
export interface ScopeCounts {
  /** Tests declared under a `from` path; absent with no `from`. */
  readonly declared?: number;
  /** Tests that entered a `to` path; absent with no `to`. */
  readonly entered?: number;
  /** `to` paths the record holds no row at or under. */
  readonly unrecorded: readonly string[];
}

/** Count the scope over `tests` tests, calling `each` on every one inside both halves. */
export function countScope(
  reading: ScopeReading,
  scope: DurationScope,
  tests: number,
  each: (test: number) => void,
): ScopeCounts {
  let declared = 0;
  let entered = 0;
  for (let test = 0; test < tests; test += 1) {
    const inFrom = reading.declared(test);
    const inTo = reading.entered(test);
    if (inFrom) declared += 1;
    if (inTo) entered += 1;
    if (inFrom && inTo) each(test);
  }
  return {
    ...(scope.from === undefined ? {} : { declared }),
    ...(scope.to === undefined ? {} : { entered }),
    unrecorded: reading.unrecorded,
  };
}

/** Whether `path` is `term` or sits under it on a `/` boundary. */
export function under(path: string, term: string): boolean {
  const bare = term.endsWith('/') ? term.slice(0, -1) : term;
  return path === bare || path.startsWith(`${bare}/`);
}

const always = (): boolean => true;

function declaredWithin(scope: DurationScope, file: string): boolean {
  return scope.from === undefined || scope.from.some((term) => under(file, term));
}

/** The scope over a snapshot, whose tests are test files. */
export function scopeOfSnapshot(view: TestCoverageView, scope: DurationScope): ScopeReading {
  const paths = view.testPath.all();
  const declared = (test: number): boolean => declaredWithin(scope, view.string(paths[test]!));
  if (scope.to === undefined) return { declared, entered: always, unrecorded: [] };

  const modules = new Set<string>();
  const unrecorded: string[] = [];
  // A row the build never read is no evidence about the file, the way
  // `testsReachingFromView` reads it: unrecorded, like no row at all.
  const ids = view.modulePath.all();
  const recorded = [...new Set(Array.from(ids, (id) => view.string(id)).filter((_, at) =>
    view.moduleInstrumented.at(at) === 1))];
  for (const term of scope.to) {
    const matched = recorded.filter((path) => under(path, term));
    if (matched.length === 0) unrecorded.push(term);
    for (const path of matched) modules.add(path);
  }
  const entered = new Set<string>();
  for (const file of modules) {
    for (const test of testsReachingFromView(view, { file }).tests) entered.add(test.test);
  }
  return { declared, entered: (test) => entered.has(view.string(paths[test]!)), unrecorded };
}

/** The scope over a case index, whose tests are cases. */
export function scopeOfCases(index: ExecutionIndex, scope: DurationScope): ScopeReading {
  const declared = (test: number): boolean => declaredWithin(scope, index.tests[test]!.file);
  if (scope.to === undefined) return { declared, entered: always, unrecorded: [] };

  const at = new Map<string, number[]>();
  index.tests.forEach((test, number) => at.set(test.id, [...(at.get(test.id) ?? []), number]));
  const entered = new Set<number>();
  const unrecorded: string[] = [];
  for (const term of scope.to) {
    const modules = index.modules.filter((module) => under(module.file, term));
    if (modules.length === 0) unrecorded.push(term);
    for (const module of modules) {
      for (const range of coveringTestsInFile(index, module.file)) {
        for (const test of range.tests) for (const number of at.get(test.id) ?? []) entered.add(number);
      }
    }
  }
  return { declared, entered: (test) => entered.has(test), unrecorded };
}

/** Every path a snapshot holds a row for, test or module, for a reader to suggest from. */
export function pathsOfSnapshot(view: TestCoverageView): readonly string[] {
  const ids = new Set([...view.testPath.all(), ...view.modulePath.all()]);
  return [...ids].map((id) => view.string(id));
}
