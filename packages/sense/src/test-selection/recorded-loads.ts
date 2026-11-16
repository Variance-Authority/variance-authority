/**
 * The files a record says a set of test files loaded late: inside a case or a
 * hook, after the file's first case began.
 *
 * Each region of the record holds two sets: the tests that entered it, and the
 * tests that had entered it before their first case began. A test that entered
 * some region of a module and none of them before its first case loaded the
 * module while it ran, as a `require` in a body or SWC's `module.lazy` does. A
 * test that entered one before, its top at the least, loaded it at import,
 * outside any case, so the module was never on a case's time. A module the
 * record holds no region for, because nothing instrumented it, is named by
 * neither, so the answer is the record's instrumented files and nothing else.
 */

// compass: variance-authority.reach

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { askCoverageFile } from './coverage-file.js';
import { projectPath } from './instrumented-modules.js';

/**
 * For each of `tests` the record at `recording` holds a row for, the files it
 * loaded late, by absolute path under `root`, in the record's order. `tests`
 * are absolute paths; a test with no row, or one that loaded everything before
 * its first case, is absent, and a recorded file the checkout no longer holds
 * is left out.
 */
export function lateLoads(recording: string, root: string, tests: readonly string[]): ReadonlyMap<string, readonly string[]> {
  const asked = new Map(tests.map((test) => [projectPath(root, test), test]));
  return askCoverageFile(recording, (view) => {
    const selected = new Map<number, string>();
    view.testPath.all().forEach((path, row) => {
      const test = asked.get(view.string(path));
      if (test !== undefined) selected.set(row, test);
    });
    const late = new Map<string, string[]>();
    if (selected.size === 0) return late;
    // A set's selected rows, decoded once however many regions name it.
    const members = new Map<number, ArrayLike<number> & Iterable<number>>();
    const selectedOf = (set: number): ArrayLike<number> & Iterable<number> => {
      let rows = members.get(set);
      if (rows === undefined) {
        rows = view.crossings.count(set) === 0 ? [] : view.crossings.members(set).filter((row) => selected.has(row));
        members.set(set, rows);
      }
      return rows;
    };
    const bounds = view.moduleBlocks.all();
    const entered = view.blockSet.all();
    const loaded = view.blockLoadedSet.all();
    view.modulePath.all().forEach((path, module) => {
      // A region's loaded set holds the tests that entered that region before their
      // first case: the module's top for one that loaded it at import, and no
      // function it only called later. So the module was early for a test that
      // is in any region's loaded set, and late for one that entered it otherwise.
      const loading = new Set<number>();
      const early = new Set<number>();
      for (let block = bounds[module]!; block < bounds[module + 1]!; block += 1) {
        for (const row of selectedOf(entered[block]!)) loading.add(row);
        for (const row of selectedOf(loaded[block]!)) early.add(row);
      }
      for (const row of early) loading.delete(row);
      if (loading.size === 0) return;
      const file = resolve(root, view.string(path));
      if (!existsSync(file)) return;
      for (const row of loading) {
        const test = selected.get(row)!;
        late.set(test, [...(late.get(test) ?? []), file]);
      }
    });
    return late;
  });
}
