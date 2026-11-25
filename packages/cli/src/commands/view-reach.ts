// compass: variance-authority.reach
/**
 * What the covering relation says to a page: for a test file, the source files
 * its cases entered, and for a source file, the test files that entered it.
 *
 * The relation is the record's case index, read once and inverted here. Nothing
 * is recomputed: a crossing is a case that entered a block, and a file is
 * reached when any of its blocks has one. Both directions are cut to `TOP`
 * with the true count beside the cut, so a page never reads a cut list as the
 * whole.
 */

import type { ExecutionIndex } from '@variance-authority/sense/test-selection';

/** How many rows of each kind the page holds. The recording keeps the rest. */
export const TOP = 100;

/** The relation as the page draws it. */
export interface ReachData {
  /** Each shown test file, with the source files its cases entered, the most-shared first. */
  readonly tests: readonly { readonly file: string; readonly reached: readonly string[]; readonly total: number }[];
  /** The source files the most test files entered, each with the test files that did. */
  readonly files: readonly { readonly file: string; readonly tests: readonly string[]; readonly total: number }[];
  /** Why the relation is empty, in words. */
  readonly note?: string;
}

/** The relation of a recording that holds none, with the reason. */
export function noReach(note: string): ReachData {
  return { tests: [], files: [], note };
}

/** Code-unit order, so a page does not depend on the reader's locale. */
function byUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The index inverted both ways, for the test files in `shown`. */
export function reachOf(index: ExecutionIndex, shown: ReadonlySet<string>): ReachData {
  const fileOf = index.tests.map((test) => test.file);
  const reached = new Map<string, Set<string>>();
  const entered = new Map<string, Set<string>>();
  for (const module of index.modules) {
    const by = new Set<string>();
    for (const block of module.blocks) for (const crossing of block.crossings) {
      const file = fileOf[crossing.test];
      if (file !== undefined && file !== module.file) by.add(file);
    }
    if (by.size === 0) continue;
    entered.set(module.file, by);
    for (const file of by) {
      if (!shown.has(file)) continue;
      const set = reached.get(file) ?? new Set<string>();
      set.add(module.file);
      reached.set(file, set);
    }
  }
  const fanIn = (file: string): number => entered.get(file)?.size ?? 0;
  const tests = [...reached].sort(([a], [b]) => byUnit(a, b)).map(([file, set]) => {
    const all = [...set].sort((a, b) => fanIn(b) - fanIn(a) || byUnit(a, b));
    return { file, reached: all.slice(0, TOP), total: all.length };
  });
  const files = [...entered]
    .sort(([a, x], [b, y]) => y.size - x.size || byUnit(a, b))
    .slice(0, TOP)
    .map(([file, set]) => ({ file, tests: [...set].sort(byUnit).slice(0, TOP), total: set.size }));
  return { tests, files };
}
