/**
 * The carried module: rows a run did not re-record, kept in the coordinates
 * the next diff will be taken in.
 *
 * Split out of [`merge.ts`](./merge.ts) by what it is about. The merge decides
 * which evidence survives a run; this file decides how a module nobody loaded is
 * carried across one — retired crossings dropped, rows re-cut from moved text,
 * and the tests that re-cut mislays named.
 *
 * Two crossing lists ride on every row and move together: `testFiles`, the
 * tests that entered the region, and `loadedBy`, the subset that entered it
 * before their first test began. Wherever one is filtered, carried or unioned
 * the other is too, and `loadedBy` is written only when it has something to
 * say — absent is the same fact as empty.
 */

import { digestString } from '../digest.js';
import { instrument, instrumentModeOf } from '../instrument/index.js';
import type { CoverageBlock, CoverageModule } from './index.js';
import { codeUnitOrder, coverageBlock } from './instrumented-modules.js';

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
    startLine: row.startLine,
    endLine: row.endLine,
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
 * merge's entire cost and the peak the process is sized by. What a run retires
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

/** Name path and structural path together: where a region is in the module's tree. */
export function addressOf(block: CoverageBlock): string {
  return `${block.name}\0${block.path}`;
}

/** Rows by key, the first of a repeated key winning: `Array.prototype.find` as an index. */
export function first<T>(rows: readonly T[], keyOf: (row: T) => string): ReadonlyMap<string, T> {
  const found = new Map<string, T>();
  for (const row of rows) {
    const key = keyOf(row);
    if (!found.has(key)) found.set(key, row);
  }
  return found;
}

/**
 * A carried module's rows, re-cut from the text the module has now.
 *
 * The rows of a module this run did not load are lines of the text it had when
 * it was recorded, and the index is about to move to where this run stands. So
 * the regions are read out of the current text and every crossing is carried
 * onto the region with its address, which leaves the evidence about the parts
 * nobody edited in coordinates the next diff will be in.
 *
 * `undefined` when there is nothing to re-cut: the text is the text the rows
 * were recorded over, or the module was recorded as not instrumented. The second
 * is the one worth naming — that row says this build never measured this module,
 * a reader widens on it, and cutting regions out of the file here would answer
 * it with a table of regions no run ever entered, an unknown turned into a
 * narrowing.
 *
 * `mislaid` when the text moved and cannot be read as source. There is no table
 * to place the crossings in and the rows that are there are ranges in text
 * nobody has, so the module is carried as it was and every test that entered it
 * is demoted: the alternative is an index that answers a diff with regions it
 * has the wrong coordinates for.
 *
 * The regions are cut under the recipe the snapshot carries, never a default:
 * an index recorded under `entries` has one row per function, and re-cutting
 * it under `presence` would spread each function's crossings over regions the
 * run never numbered.
 */
export function recutRows(
  module: CoverageModule,
  source: string,
  instrumentation: string,
): CoverageModule | 'mislaid' | undefined {
  if (!module.instrumented) return undefined;
  if (digestString(source) === module.sourceDigest) return undefined;
  const mode = instrumentModeOf(instrumentation);
  const fresh = mode === undefined ? undefined : instrument(source, module.file, module.file, { mode });
  if (fresh === undefined) return 'mislaid';
  const before = new Map(module.blocks.map((block) => [addressOf(block), block]));
  return {
    file: module.file,
    sourceDigest: fresh.sourceDigest,
    instrumented: true,
    blocks: fresh.blocks.map((block) => {
      const row = coverageBlock(source, block);
      const previous = before.get(addressOf(row));
      return previous !== undefined && reusableBlock(row, previous)
        ? crossedBlock(row, previous.testFiles, previous.loadedBy ?? [])
        : row;
    }),
  };
}

/**
 * The tests the re-cut rows have nowhere to put a crossing for.
 *
 * Losing one region is not losing a test. Arrival nests — a test that entered a
 * region entered every region around it, up to the module — so a test whose
 * function was deleted still has its crossing on whatever now spans the place
 * that function was, and a diff there still reaches it. A test is only mislaid
 * when the new text holds no region it is recorded against at all.
 */
export function lostCrossings(before: CoverageModule, after: CoverageModule): readonly string[] {
  const kept = new Set(after.blocks.flatMap((block) => block.testFiles));
  return [...new Set(before.blocks.flatMap((block) => block.testFiles))].filter(
    (test) => !kept.has(test),
  );
}

/**
 * Whether a crossing recorded against the previous region carries to this one.
 *
 * The address carries it: the declaration name path and the structural path
 * inside it, which is where the region is in the module's tree rather than where
 * it is in the module's text. Both sides of this call already share that
 * address; the kind is the one thing left that can differ under it, and a region
 * that changed kind under one address is a different region.
 *
 * What deliberately does not enter: the region's own digest, and anything at all
 * about the regions above it. A digest that moved says the text changed, and the
 * reader that cares about changed text is selection, which charges the region
 * from the diff and runs every test recorded against it — the crossing is what
 * makes that possible, so discarding it here would remove the evidence the
 * change is about to be answered with. Reading the owners as well made any edit
 * to a module's top level — an added declaration, a renamed export, a changed
 * constant — move the root's digest and retire every crossing in the file, which
 * is the whole suite demoted for a function nobody calls yet.
 */
export function reusableBlock(
  current: Pick<CoverageBlock, 'kind'>,
  previous: Pick<CoverageBlock, 'kind'>,
): boolean {
  return current.kind === previous.kind;
}
