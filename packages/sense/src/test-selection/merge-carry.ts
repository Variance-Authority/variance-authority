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
import { codeUnitOrder } from './instrumented-modules.js';
import { coverageBlock } from './coverage-rows.js';
import { sourceLines } from './source-lines.js';

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

/** Name path and structural path together: where a region is in the module's tree. */
export function addressOf(block: CoverageBlock): string {
  return `${block.name}\0${block.path}`;
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

/** A module's rows, each paired with the address its crossings carry by. */
export function addressed(
  blocks: readonly CoverageBlock[],
): readonly (readonly [string, CoverageBlock])[] {
  const seen = new Map<string, number>();
  return blocks.map((block) => [addressKey(addressOf(block), seen), block] as const);
}

/** A numbered step in an address: `if#0`, `for#12`, `anon#3`, never a `#private` member. */
const SEAT = /^(.*)#(\d+)$/;

/**
 * Every counter an address passes through, each with the number it took there.
 *
 * A counter is local to the place that holds it: the walk opens a fresh set for
 * each named declaration and keys them by the structural path and the kind
 * inside it, so `apply`'s branches are counted among `apply`'s branches and the
 * branches nested in one of them are counted among their own. The site is that
 * key read back off the address — everything up to the numbered step, plus what
 * was being counted — and the number is the seat the region took at it.
 */
export function seatsOf(block: CoverageBlock): readonly (readonly [string, number])[] {
  const found: (readonly [string, number])[] = [];
  const steps = (path: string, from: string): string => {
    let at = from;
    for (const step of path === '' ? [] : path.split('/')) {
      const seat = SEAT.exec(step);
      if (seat !== null) found.push([`${at}/${seat[1]}`, Number(seat[2])]);
      at = `${at}/${step}`;
    }
    return at;
  };
  steps(block.path, `${steps(block.name, '')}\0`);
  return found;
}

/**
 * Whether the fresh cut seated its regions where the recorded one seated them.
 *
 * Half of an address is positional. The walk numbers each region among the
 * siblings of its kind in the place that holds them — `if#0/then`, `if#1/then`,
 * `anon#2` — in source order, so the number is not a name a region keeps but a
 * seat it occupies. Delete the first of two branches and the second one's
 * regions are cut as `if#0/*`: the address the deleted branch had, over text it
 * never covered. The kinds match, because a branch replaced a branch, so the
 * crossings of the region that is gone are carried onto the region that
 * survived, and the crossings recorded for the survivor — under the number it no
 * longer has — are dropped. Write a branch in front of it instead and the same
 * slide runs the other way, with the seat the recorded branch used to hold
 * filled by a region no run has ever entered, which is an empty crossing set
 * where the truth is that nobody measured it.
 *
 * Nothing downstream can see it. Arrival nests, so the tests that lost their
 * region still hold the function and the module and no demotion answers for
 * them, and the re-cut rows are written with the digest of the text standing
 * now, so the reader that checks whether a module's coordinates are still the
 * tree's agrees and charges nothing. A diff inside the surviving branch is then
 * answered with the test that entered the deleted one, and the test that entered
 * exactly those lines is in the caller's skip list.
 *
 * So the seats are counted first, one counter at a time. Where both cuts
 * numbered something at the same site, the seats taken there have to be the same
 * ones: two cuts agreeing on which numbers a counter handed out is what makes a
 * number mean the same region in both. When they disagree the module is mislaid,
 * because a counter that hands out a different set of numbers has moved
 * everything behind the one that changed — the shift is never local to the
 * sibling that moved.
 *
 * A site only one cut counted anything at is left alone, and that is the common
 * carry rather than a corner. A function written under an old one opens counters
 * of its own and moves nothing already numbered; a branch nested inside an
 * existing one opens another; deleting `decide` takes `decide/if#0/then` with it
 * and renumbers nothing around it. Those are ordinary gained and lost regions,
 * which the re-cut already answers — a gained one from the region around it, a
 * lost one through the crossings it nests into — and mislaying a whole module
 * over one would retire evidence still true about every other line in the file.
 *
 * What is left is a counter whose population changed, and there the two readings
 * are a region appended after the last one and a region pushed in front of the
 * first. The addresses are the same either way, and the table holds nothing that
 * tells them apart, so the module is mislaid for both: an ambiguity answered by
 * guessing is a false skip half the time, and answered by carrying the module as
 * it was it is a file charged whole until some run records it again.
 */
export function sameNumbering(
  before: readonly CoverageBlock[],
  after: readonly CoverageBlock[],
): boolean {
  const seats = (blocks: readonly CoverageBlock[]): ReadonlyMap<string, ReadonlySet<number>> => {
    const sites = new Map<string, Set<number>>();
    for (const block of blocks) {
      for (const [site, seat] of seatsOf(block)) {
        const taken = sites.get(site) ?? new Set<number>();
        taken.add(seat);
        sites.set(site, taken);
      }
    }
    return sites;
  };
  const now = seats(after);
  for (const [site, taken] of seats(before)) {
    const holds = now.get(site);
    if (holds === undefined) continue;
    if (holds.size !== taken.size || [...taken].some((seat) => !holds.has(seat))) return false;
  }
  return true;
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
 * The walk stops at the module root, which is addressed the same way in every
 * cut of a file and so is never itself born, and a `seen` set stops it anyway on
 * an owner chain that points at itself. Each row is resolved once and the answer
 * is kept for the rows below it, so the whole module costs one pass.
 */
export function crossingsAround(
  blocks: readonly CoverageBlock[],
  held: (block: CoverageBlock) => Crossings | undefined,
): (block: CoverageBlock) => Crossings {
  const none: Crossings = { testFiles: [], loadedBy: [] };
  const byOrdinal = new Map(blocks.map((block) => [block.ordinal, block] as const));
  const resolved = new Map<number, Crossings>();
  return (block: CoverageBlock): Crossings => {
    const handed: CoverageBlock[] = [];
    const seen = new Set<number>();
    let at: CoverageBlock | undefined = block;
    let answer = none;
    while (at !== undefined && !seen.has(at.ordinal)) {
      seen.add(at.ordinal);
      const already = resolved.get(at.ordinal);
      if (already !== undefined) {
        answer = already;
        break;
      }
      const own = held(at);
      if (own !== undefined) {
        resolved.set(at.ordinal, own);
        answer = own;
        break;
      }
      handed.push(at);
      at = at.owner === undefined ? undefined : byOrdinal.get(at.owner);
    }
    for (const row of handed) resolved.set(row.ordinal, answer);
    return answer;
  };
}

/**
 * A carried module's rows, re-cut from the text the module has now.
 *
 * The rows of a module this run did not load are lines of the text it had when
 * it was recorded, and the index is about to move to where this run stands. So
 * the regions are read out of the current text and every crossing is carried
 * onto the region with its address, which leaves the evidence about the parts
 * nobody edited in coordinates the next diff will be in. A region the text has
 * now and the rows never had takes the crossings of the region around it, by
 * {@link crossingsAround} — the alternative is a row saying nobody entered
 * lines nobody has measured.
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
  const fresh = mode === undefined ? undefined : instrument(source, module.file, module.file, { mode });
  if (fresh === undefined) return 'mislaid';
  // One lookup for the whole module: the default counts newlines from the top
  // of the file on every offset, and a module re-cut here asks twice per region.
  const extentOf = sourceLines(source, undefined, module.file);
  const rows = fresh.blocks.map((block) => coverageBlock(source, block, extentOf));
  if (!sameNumbering(module.blocks, rows)) return 'mislaid';
  const before = new Map(addressed(module.blocks));
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
    blocks: addressed(rows)
      .map(([address, row]) => {
        const previous = before.get(address);
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
