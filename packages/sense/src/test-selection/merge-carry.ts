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
import { instrumentModeOf } from '../instrument/index.js';
import type { CoverageBlock, CoverageModule } from './index.js';
import { codeUnitOrder } from './instrumented-modules.js';
import { sourceCut } from './coverage-rows.js';
import { pairedAcrossEdit, sameNumbering } from './region-address.js';
import { heldAround } from './region-around.js';

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

/** Rows by key, the first of a repeated key winning: `Array.prototype.find` as an index. */
export function first<T>(rows: readonly T[], keyOf: (row: T) => string): ReadonlyMap<string, T> {
  const found = new Map<string, T>();
  for (const row of rows) {
    const key = keyOf(row);
    if (!found.has(key)) found.set(key, row);
  }
  return found;
}

/** A region's two crossing lists, off a row or handed down from the region around it. */
export interface Crossings {
  readonly testFiles: readonly string[];
  readonly loadedBy: readonly string[];
}

/**
 * Each row's carried crossings, with a region nothing was carried onto reading
 * them off the nearest region around it that something was.
 *
 * A merge places crossings by identity — an address in a re-cut module, a row
 * object in a re-recorded one — and a region that did not exist when the
 * evidence was taken has no identity to place them by. It is born with an empty
 * crossing list, and an empty crossing list is not an absence of crossings: it
 * is the sentence *no test entered these lines*, written about lines no run has
 * ever been asked about.
 *
 * Nothing downstream reads it as anything else, and no valve stands behind it.
 * The tests that hold the function the region was carved out of still hold the
 * function and still hold the module, so none of them lost every crossing and
 * none of them is demoted; they stay whole and stay in `whole`. The module still
 * has instrumented rows, so its name is excluded from `unread` and the reader's
 * widening valve is shut. The re-cut rows are written with the digest of the
 * text standing now, so the reader that checks whether a module's coordinates
 * are still the tree's agrees and charges nothing. A diff on an interior line of
 * the new region is then answered by that row alone — the line is inside a
 * recorded region, so the fallback that charges a module whole for a line in no
 * region never fires — and the answer is nobody, against a `whole` that names
 * the entire suite. The caller's skip list is `whole` minus nobody, and the run
 * skips every test it has.
 *
 * So a born region is given the crossings of the region around it. Arrival
 * nests: a test that entered a region entered every region around it, up to the
 * module, and read backwards that says every test standing on the enclosing
 * region was somewhere inside it — including, for all this index knows, here.
 * Handing those tests down is the same reading selection already makes when a
 * line falls in no recorded region at all and the module answers for it; this
 * only extends it to a line that has a row saying nothing rather than no row.
 *
 * It is the narrower of the two honest answers. The other is to demote every
 * test holding a module that gained a region, which runs them against every
 * later diff anywhere in that file; at two hundred thousand modules under edit
 * that is most of the suite, most of the time, for a helper nobody called yet.
 * Handing the crossings down answers only the diffs that actually land in the
 * new region, and answers them with the tests that were running the code it was
 * cut out of.
 *
 * Both lists ride together, as they do everywhere else here. `loadedBy` is a
 * subset of `testFiles` that every reader unions back into it, so carrying one
 * without the other would leave a row whose subset is not a subset of what it
 * came from, and would narrow nothing in exchange.
 *
 * The walk follows each row's owner and stops at the module root, which is
 * addressed the same way in every cut of a file and so is never itself born;
 * {@link heldAround} walks it, and walks the case index's regions by the same
 * owners, which the fold writes beside them.
 */
export function crossingsAround(
  blocks: readonly CoverageBlock[],
  held: (block: CoverageBlock) => Crossings | undefined,
): (block: CoverageBlock) => Crossings {
  const byOrdinal = new Map(blocks.map((block) => [block.ordinal, block] as const));
  const owner = (block: CoverageBlock): CoverageBlock | undefined =>
    block.owner === undefined ? undefined : byOrdinal.get(block.owner);
  return heldAround(owner, held, { testFiles: [], loadedBy: [] });
}

/**
 * A carried module's rows, re-cut from the text the module has now.
 *
 * The rows of a module this run did not load are lines of the text it had when
 * it was recorded, and the index is about to move to where this run stands. So
 * the regions are read out of the current text and every crossing is carried
 * onto the region with its address, which leaves the evidence about the parts
 * nobody edited in coordinates the next diff will be in. Namesakes, regions
 * told apart only by occurrence, carry onto the namesake with their body
 * ({@link pairedAcrossEdit}): across an edit, occurrence does not say which is
 * which, and a namesake whose body moved is a region gained. A region the text
 * has now and the rows never had takes the crossings of the region around it,
 * by {@link crossingsAround} — the alternative is a row saying nobody entered
 * lines nobody has measured.
 *
 * The rows say nothing about who ran the edit; {@link owedByRecut} names the
 * tests they owe a run.
 *
 * `undefined` when there is nothing to re-cut: the text is the text the rows
 * were recorded over, or the module was recorded as not instrumented. The second
 * is the one worth naming — that row says this build never measured this module,
 * a reader widens on it, and cutting regions out of the file here would answer
 * it with a table of regions no run ever entered, an unknown turned into a
 * narrowing.
 *
 * `mislaid` when the crossings cannot be placed in the new text. Either there is
 * no table at all — the text moved and cannot be read as source — or there is one
 * whose regions were seated by a counter that handed out different numbers this
 * time, which {@link sameNumbering} decides. Both leave the rows as ranges in
 * text nobody has, so the module is carried as it was and every test that entered
 * it is demoted: the alternative is an index that answers a diff with regions it
 * has the wrong coordinates for. Carried as it was, the module keeps the digest
 * of the text its rows were cut from too, so the reader that checks a module's
 * coordinates against the tree finds them stale and charges the module whole
 * until some run records it again.
 *
 * A region the current text holds and the table has no address for is text
 * written after the recording, and no instrument ever ran over it. Its row
 * cannot be emitted holding nothing. An empty crossing set is exactly what a
 * region a run entered and no test reached looks like, the two are the same
 * bytes from here on, and the reader that meets one narrows on it — which is
 * the table of regions no run ever entered that the uninstrumented case above
 * refuses, committed here for every function and branch a module gained since
 * the last run that loaded it. So a gained region takes the crossings of the
 * region around it, and that is honest in both directions. Arrival nests, so
 * every test that reached the new text reached the region containing it: the
 * enclosing row is the upper bound, and an upper bound keeps the tests that may
 * have run. A region gained inside one the record measured empty inherits that
 * empty, which is not an invention but the deduction the measurement supports —
 * a test that never entered the branch entered nothing written inside it. The
 * set handed over is the enclosing row's own, so where crossings are pooled by
 * identity this widening adds no set to store.
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
  const fresh = mode === undefined ? undefined : sourceCut(source, module.file, mode);
  if (fresh === undefined) return 'mislaid';
  const rows = fresh.rows;
  if (!sameNumbering(module.blocks, rows)) return 'mislaid';
  const from = pairedAcrossEdit(module.blocks, rows);
  // Rows by ordinal as they are decided, which is what a gained region reads its
  // enclosing region's crossings out of. `owner` is the ordinal of the region
  // around this one and the walk that numbered them opened it first, so the row
  // a gained one inherits from is always already here; the module root, the one
  // row with no owner, has nothing wider to take and keeps what it was cut with.
  const cut = new Map<number, CoverageBlock>();
  return {
    file: module.file,
    sourceDigest: fresh.sourceDigest,
    instrumented: true,
    blocks: rows.map((row, at) => {
      const previous = from[at]! < 0 ? undefined : module.blocks[from[at]!];
      const around = row.owner === undefined ? undefined : cut.get(row.owner);
      const decided =
        previous !== undefined && reusableBlock(row, previous)
          ? crossedBlock(row, previous.testFiles, previous.loadedBy ?? [])
          : around === undefined
            ? row
            : crossedBlock(row, around.testFiles, around.loadedBy ?? []);
      cut.set(row.ordinal, decided);
      return decided;
    }),
  };
}

/**
 * The tests a re-cut leaves without a whole observation of the text it is cut
 * from, which the caller demotes unless this run observed them.
 *
 * A test on a region whose text moved never ran the text the rows now stand
 * on. The re-cut rows carry the digest of the text standing now, the landing
 * keeps that text, and selection frames the rows by it, so the next diff no
 * longer holds the edit: undemoted, the test is skipped over a body it never
 * ran. A region the text gained is edited text too, holding the crossings of
 * the region around it. Both are decided by {@link editedRegion}, as a
 * re-recorded module's are, so the two paths demote for the same edit.
 *
 * Neither demotes for a region `reaches` says the edit left alone, by the
 * selector's verdict ({@link editReaches}): a type or a comment moves the
 * digest of every region around it, and every test on those would otherwise be
 * owed a run.
 *
 * A test the new text holds no region for at all is owed a run as well. Losing
 * one region is not losing a test — arrival nests, so a deleted function's
 * test keeps its crossing on whatever spans the place it was — but a test with
 * no region left has nowhere a diff could reach it.
 */
export function owedByRecut(
  before: CoverageModule,
  after: CoverageModule,
  reaches: (kind: string) => boolean,
): readonly string[] {
  const from = pairedAcrossEdit(before.blocks, after.blocks);
  const owed = new Set<string>();
  for (const [at, row] of after.blocks.entries()) {
    const was = from[at]! < 0 ? undefined : before.blocks[from[at]!];
    const unmoved = was !== undefined && reusableBlock(row, was) && !editedRegion(
      { sourceDigest: after.sourceDigest, digest: row.digest },
      { sourceDigest: before.sourceDigest, digest: was.digest },
    );
    if (!unmoved && reaches(row.kind)) for (const test of row.testFiles) owed.add(test);
  }
  const kept = new Set(after.blocks.flatMap((block) => block.testFiles));
  for (const block of before.blocks) for (const test of block.testFiles) if (!kept.has(test)) owed.add(test);
  return [...owed];
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
 * change is about to be answered with. The callers carry such a crossing and
 * demote each test on it that the run did not observe: the landing keeps the
 * edited text and selection frames the rows by it, so the diff from that text
 * no longer holds the edit those tests never ran over. Reading the owners as well made any edit
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

/**
 * Whether a region carried at its address was edited between the two cuts.
 *
 * A region's digest is taken of the text the probes were spliced into, which
 * is a build's output and not the file the author edited. One source reaches a
 * suite as more than one build — a package's own tests load `src/thing.ts`
 * through the runner's transform, and every other package's tests load
 * `dist/thing.js` — and both are recorded under the source's path and the
 * source's digest, so the two cut one unedited region under two digests. The
 * source digest is the owner of *was this text edited*: where it stands, no
 * region in it moved, whatever the emitted text says. Only where it moved does
 * a region's digest say which regions moved with it.
 */
export function editedRegion(
  current: { readonly sourceDigest: string; readonly digest: string },
  previous: { readonly sourceDigest: string; readonly digest: string },
): boolean {
  return current.sourceDigest !== previous.sourceDigest && current.digest !== previous.digest;
}
