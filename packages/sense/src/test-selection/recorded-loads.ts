/**
 * The files a record says a set of test files loaded.
 *
 * A module is loaded by a test when one of its regions names that test in
 * either of its two sets: the tests that entered the region, and the tests
 * that had loaded it before their first case began. A module the record holds
 * no region for, because nothing instrumented it, is named by neither, so the
 * answer is the record's instrumented files and nothing else.
 */

// compass: variance-authority.reach

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { askCoverageFile } from './coverage-file.js';
import { projectPath } from './instrumented-modules.js';

/**
 * Every file the record at `recording` says one of `tests` loaded, by absolute
 * path under `root`, in the record's order. `tests` are absolute paths; a test
 * the record holds no row for adds nothing, and a recorded file the checkout no
 * longer holds is left out.
 */
export function recordedLoads(recording: string, root: string, tests: readonly string[]): readonly string[] {
  const asked = new Set(tests.map((test) => projectPath(root, test)));
  return askCoverageFile(recording, (view) => {
    const selected = new Set<number>();
    view.testPath.all().forEach((path, row) => {
      if (asked.has(view.string(path))) selected.add(row);
    });
    if (selected.size === 0) return [];
    const reaching = new Map<number, boolean>();
    const reaches = (set: number): boolean => {
      let answer = reaching.get(set);
      if (answer === undefined) {
        answer = view.crossings.count(set) > 0 && view.crossings.members(set).some((row) => selected.has(row));
        reaching.set(set, answer);
      }
      return answer;
    };
    const bounds = view.moduleBlocks.all();
    const entered = view.blockSet.all();
    const loaded = view.blockLoadedSet.all();
    const loads: string[] = [];
    view.modulePath.all().forEach((path, module) => {
      for (let block = bounds[module]!; block < bounds[module + 1]!; block += 1) {
        if (!reaches(entered[block]!) && !reaches(loaded[block]!)) continue;
        const file = resolve(root, view.string(path));
        if (existsSync(file)) loads.push(file);
        return;
      }
    });
    return loads;
  });
}
