/**
 * The carried module: rows a run did not re-record, with the crossings of the
 * tests it retired dropped, and the addresses those rows carry by.
 *
 * Two crossing lists ride on every row and move together: `testFiles`, the
 * tests that entered the region, and `loadedBy`, the subset that entered it
 * before their first test began. Wherever one is filtered, carried or unioned
 * the other is too, and `loadedBy` is written only when it has something to
 * say — absent is the same fact as empty.
 */

import { codeUnitOrder } from '@variance-authority/core/segment';
import type { CoverageBlock, CoverageModule } from './index.js';

/**
 * A row with both crossing lists replaced, each distinct and in code-unit
 * order, and `loadedBy` present only when it is not empty.
 */
export function crossedBlock(
  block: CoverageBlock,
  testFiles: Iterable<string>,
  loadedBy: Iterable<string>,
): CoverageBlock {
  const early = [...new Set(loadedBy)].sort(codeUnitOrder);
  const row: CoverageBlock = { ...block, testFiles: [...new Set(testFiles)].sort(codeUnitOrder) };
  if (early.length > 0) return { ...row, loadedBy: early };
  if (row.loadedBy === undefined) return row;
  return {
    ordinal: row.ordinal,
    kind: row.kind,
    ...(row.owner === undefined ? {} : { owner: row.owner }),
    digest: row.digest,
    name: row.name,
    path: row.path,
    ...(row.startLine === undefined ? {} : { startLine: row.startLine, endLine: row.endLine }),
    source: row.source,
    testFiles: row.testFiles,
  };
}

/**
 * A carried module with retired crossings dropped, and the module itself when
 * it holds none of them.
 *
 * Almost every module in an index is carried. A run re-records the files it
 * loaded and the rest stand exactly as they were, so rebuilding each of them to
 * remove a handful of tests that entered none of their regions rebuilds the
 * whole index to change nothing — at two hundred thousand modules that is the
 * fold's entire cost and the peak the process is sized by. What a run retires
 * is what it re-recorded, which is small and local, so the answer for nearly
 * every module is the object that came in.
 */
export function withoutRetired(module: CoverageModule, retired: ReadonlySet<string>): CoverageModule {
  const holds = (block: CoverageBlock): boolean =>
    block.testFiles.some((test) => retired.has(test));
  if (retired.size === 0 || !module.blocks.some(holds)) return module;
  const kept = (test: string): boolean => !retired.has(test);
  return {
    ...module,
    blocks: module.blocks.map((block) =>
      holds(block)
        ? crossedBlock(block, block.testFiles.filter(kept), (block.loadedBy ?? []).filter(kept))
        : block,
    ),
  };
}

/**
 * The same address told apart from the ones before it in the module: which
 * occurrence of it this row is.
 *
 * An address is not unique inside a module. A call-argument closure is named
 * after the callee it is an argument to, so two `useEffect(() => …)` bodies in
 * one component are both `<component>/useEffect.arg0` at `entry` — one address
 * over two regions, and the shape is ordinary React rather than a corner. Rows
 * placed by the bare address all land on the first row that answers to it, and
 * the crossings of every later region overwrite the ones before them: one
 * region's tests are dropped and another's are carried onto lines they were
 * never recorded against, with no demotion, because every previous row did find
 * somewhere to go. A diff inside the first of the twins is then answered with
 * the tests that entered the second, and the test that entered exactly those
 * lines is skipped.
 *
 * So repeats are told apart by their occurrence number in the order the recipe
 * numbered the regions, which is the order both sides read them in. The n-th of
 * an address carries onto the n-th of it that is still there, and one that is
 * gone loses its crossings the way any deleted region does — through the
 * unmatched-row path that demotes the tests standing on it.
 */
export function addressKey(address: string, seen: Map<string, number>): string {
  const nth = (seen.get(address) ?? 0) + 1;
  seen.set(address, nth);
  return `${address}\0${nth}`;
}
