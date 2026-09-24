import { blocksAround, regionOf } from './blocks-around.js';
import type { TestCoverageView } from './format-view.js';
import { answerByImporters, type ExecutionNarrowingOptions, type ImporterReason } from './importers.js';
import { findModules } from './lookup.js';
import { changedLines } from './diff-lines.js';
import { hunksOf } from './patch.js';
import { frameOf } from './frame.js';
import { readChange, readRowless, type FileReading } from './reading.js';
import { bindsOnly } from './inert.js';
import { disownedIn } from './shadowed.js';

export type { ExecutionNarrowingOptions, FileReading, ImporterReason };

/**
 * What one snapshot can say about one diff: who it speaks for, and who the diff
 * reached.
 *
 * `selectTestFilesFromView` answers the second half alone, and an empty answer
 * from it has two readings that are opposite facts — *this diff reached nobody*,
 * and *this snapshot recorded nobody*. A caller that narrows a suite on the
 * first while holding the second skips every subject it has, silently, because a
 * subject that was never run is not in the report to be missing from.
 *
 * So `whole` is returned beside it. It is the tests whose observation was
 * complete, and only those: an upper-bound contribution cannot justify excluding
 * anything, and a test absent from the snapshot entirely is unknown rather than
 * untouched.
 */
export interface ExecutionNarrowing {
  /** Recorded tests whose observation was whole, so absence from `entered` is evidence. */
  readonly whole: readonly string[];
  /** Recorded tests that entered a region this diff changed. */
  readonly entered: readonly string[];

  /**
   * Changed paths the record and the graph hold nothing about: no row under
   * any name the file may be held by, no precondition, and no place in the
   * graph when the caller handed one over.
   *
   * The record decides what a change reaches. A module with no row is answered
   * by the nearest importers that have one, and selects nobody when no chain
   * of imports reaches a row; so does a stylesheet nothing recorded imports.
   * What is listed here is different: a file the sense database has never
   * heard of — a README, a fixture the tests read with `fs`, a script they
   * spawn, a file outside the directories the scan was pointed at. It is a
   * report, not a widening, and no caller widens on it: a suite that depends
   * on such a file declares it as a precondition, and it stops appearing here.
   * A moved package is never here; its measured importers answer for it.
   *
   * Empty is the ordinary state.
   */
  readonly unread: readonly string[];

  /**
   * Changed modules whose recording was cut from a different text than the one
   * the diff is written against, so their line ranges were not read.
   *
   * A snapshot's ranges are coordinates in the text the suite ran over, and its
   * label is the commit `git rev-parse HEAD` named at that moment. A suite is
   * recorded *by being run*, so in a developer's loop or an agent's the tree is
   * dirty every time and the two are different texts — the ranges number lines
   * the commit never had. A hunk then lands on whichever region occupies those
   * numbers now, which answers with other tests, or with none, and the run is
   * green over a change nothing watched.
   *
   * Each of these is charged whole instead, which is what the snapshot can
   * still say honestly about it. Empty is the ordinary state, and a snapshot
   * recorded over a clean tree keeps it empty. It is listed because the
   * widening is a fact about the *recording*, not about the diff: a name that
   * keeps appearing here is a suite being recorded over an edited tree, and it
   * is fixed by recording once on a clean one, not by changing the query.
   *
   * Populated only when the caller supplies `sourceAt`. Without it nothing is
   * checked and this is empty because nothing looked — which is not the same
   * fact, and is why the option is named on the query rather than assumed.
   */
  readonly stale: readonly string[];

  /**
   * Why each test in `entered` is there: one entry per selected test, in the
   * same order, naming every region, precondition, and import chain that
   * selected it.
   *
   * A test that keeps running after a change is a question with three answers —
   * a probe placed wider than the edit, a precondition declared wider than it
   * needs to be, or a real dependency — and they are fixed in three different
   * places. `entered` alone cannot tell them apart. The reasons are the facts
   * the inner loop already held when it selected the test, kept rather than
   * discarded, so what a run prints about itself is what it did.
   */
  readonly because: readonly SelectionCause[];

  /**
   * What the parser made of each changed file whose frame was proved: which
   * verdict charged it, or why it was charged by its lines alone. Without
   * `sourceAt` every file is `unread: 'source'`: the old text is only ever held
   * through it. Absent from an answer that never read a diff: one asked at a
   * point, or of a recording that selects by journeys.
   */
  readonly readings?: readonly FileReading[];
}

/** One selected test and everything that selected it. */
export interface SelectionCause {
  readonly test: string;
  readonly via: readonly SelectionReason[];
}

/**
 * One fact that put a test in `entered`.
 *
 * A `region` is a recorded block a changed line landed in, named the way the
 * journal names it — the enclosing declaration and the path to the block inside
 * it — with the source lines it spans, under the name the snapshot holds the
 * module by. A `precondition` is a changed file the test declared as governing
 * it: its own source, a setup file, a configuration. An `importer` is the chain
 * of imports from a changed file with no instrumented row to the file whose row
 * answered for it, which is how `ExecutionNarrowingOptions.relations` answers a
 * stylesheet, and a module the recording did not instrument.
 */
export type SelectionReason =
  | {
      readonly kind: 'region';
      readonly file: string;
      readonly name: string;
      readonly path: string;
      readonly startLine: number;
      readonly endLine: number;
    }
  | { readonly kind: 'precondition'; readonly name: string }
  | {
      /** A place that reads a value the change moved: `file` declares `name`, `reader` reads it. */
      readonly kind: 'reader';
      readonly name: string;
      readonly file: string;
      readonly reader: string;
      readonly region?: Extract<SelectionReason, { kind: 'region' }>;
    }
  | ImporterReason;

/** Both halves of the question, from one pass over the same columns. */
export function narrowByExecutionFromView(
  coverage: TestCoverageView,
  diff: string,
  options: ExecutionNarrowingOptions = {},
): ExecutionNarrowing {
  const whole: string[] = [];
  for (let test = 0; test < coverage.testPath.length; test += 1) {
    if (coverage.testComplete.at(test) === 1) whole.push(coverage.string(coverage.testPath.at(test)));
  }

  return { whole: whole.sort(codeUnitOrder), ...readDiff(coverage, diff, options) };
}

/** Query the binary columns without materializing the coverage graph. */
export function selectTestFilesFromView(
  coverage: TestCoverageView,
  diff: string,
  options: ExecutionNarrowingOptions = {},
): readonly string[] {
  return readDiff(coverage, diff, options).entered;
}

/**
 * Every changed file, asked of the snapshot under every name it may be held by.
 *
 * A file with an instrumented row under any of its names is answered by the
 * regions its changed lines fell in, from every such row. Every name is asked
 * of the preconditions. A file with no instrumented row under any name is asked
 * of the graph, whose nearest importers with a row answer for it, and is
 * reported as unread under the name the diff gave it when neither the record
 * nor the graph holds it.
 */
function readDiff(
  coverage: TestCoverageView,
  diff: string,
  options: ExecutionNarrowingOptions,
): Required<Pick<ExecutionNarrowing, 'entered' | 'unread' | 'because' | 'stale' | 'readings'>> {
  const knownAs = options.knownAs ?? ((file: string): readonly string[] => [file]);
  const selected = new Map<number, SelectionReason[]>();
  const select = (test: number, reason: SelectionReason): void => {
    const reasons = selected.get(test) ?? [];
    reasons.push(reason);
    selected.set(test, reasons);
  };
  const changed = changedLines(diff);
  const governing = new Set<string>();
  const rowed = new Set<string>();
  const stale = new Set<string>();
  // A test that mocked the module is not the audience of what it only loaded there (`shadowed.ts`).
  const disowned = disownedIn(coverage, options.relations);

  const hunks = hunksOf(diff);
  const readings: FileReading[] = [];
  const seen = new Set<string>();
  const charge = (file: string, block: number, reason: SelectionReason): void => {
    for (const test of coverage.crossings.members(coverage.blockSet.at(block))) {
      if (disowned?.(file, test, block) !== true) select(test, reason);
    }
  };
  const context = { coverage, options, knownAs, hunks, charge, pick: select };

  for (const [file, ranges] of changed) {
    // Every row recorded under every name. One build reading a path is one
    // row; two builds reading it are two, each with its own crossings, and the
    // answer is all of them. `instrumented: false` is the build saying it never
    // read this module — not that nothing ran in it — and its zero blocks
    // would otherwise select nobody and look like an answer, so it takes
    // nothing from the instrumented row beside it.
    const rowsOf = new Map<string, readonly number[]>();
    for (const name of knownAs(file)) {
      // Every changed name is asked of the precondition table, whatever its
      // rows say. A row and a declaration answer different questions: the row
      // says which tests entered which regions of this module, the declaration
      // says the observation is void if the file's text moves at all. No
      // recorder writes the second where it can write the first, so what is
      // left in the table is what no row can answer: a test's own file, a
      // configured setup file, a module some other run never instrumented.
      governing.add(name);
      const rows = findModules(coverage, name).filter((module) => coverage.moduleInstrumented.at(module) === 1);
      if (rows.length === 0) continue;
      rowed.add(name);
      rowsOf.set(name, rows);
    }
    if (rowsOf.size === 0) {
      // No row to charge, so its readers answer for it where a reading can be
      // made. A file read that way is answered, and the walk over its importers
      // below — which charges them whole — is for what the reading left.
      const read = ranges.length === 0 ? undefined : readRowless(context, file);
      if (read !== undefined) readings.push(read.reading);
      if (read?.charged === true) for (const name of knownAs(file)) rowed.add(name);
      continue;
    }
    // A caller that writes one file's hunks under each of its names hands the
    // same change over twice, and every name of it was charged the first time.
    const held = [...rowsOf.keys()].sort(codeUnitOrder).join('\n');
    if (seen.has(held)) continue;
    seen.add(held);

    // Everything below reads line numbers, and a line number is only a place
    // in the text it was cut from. The recorder wrote a digest of that text,
    // so whether these numbers mean anything here is a question the snapshot
    // answers about itself.
    const frame = frameOf(coverage, knownAs(file), rowsOf, options.sourceAt);
    if (frame === 'stale') {
      for (const [name, rows] of rowsOf) {
        stale.add(name);
        for (const module of rows) chargeAll(coverage, module, (block) => charge(file, block, regionOf(coverage, name, block)));
      }
      continue;
    }
    if (frame === 'unchecked') readings.push({ file, unread: 'source' });
    else if (ranges.length > 0) {
      const read = readChange(context, file, ranges, frame, rowsOf);
      readings.push(read.reading);
      if (read.charged) continue;
    }

    for (const [name, rows] of rowsOf) {
      for (const module of rows) {
        const first = coverage.moduleBlocks.at(module);
        const end = coverage.moduleBlocks.at(module + 1);
        const blocks = new Set<number>();
        // A file the diff names without lines — a binary, a rename, a mode — is
        // every region of it.
        if (ranges.length === 0) for (let block = first; block < end; block += 1) blocks.add(block);
        for (const range of ranges) {
          // Text that only binds a name changed nothing that already ran, and
          // the gap it opens would otherwise be charged to the module itself —
          // every test that ever imported the file, for a function nobody calls
          // yet.
          if (range.added !== undefined && bindsOnly(range.added)) continue;
          for (const block of blocksAround(coverage, first, end, range)) blocks.add(block);
        }
        for (const block of blocks) charge(file, block, regionOf(coverage, name, block));
      }
    }
  }

  // A row answers for its file, and the graph is walked only for a file no
  // name of which has one: `rowed` says which, so the walk does not ask the
  // snapshot again. The changed names go to the graph's own walk with the
  // modules it reached that carry no probes, which need the same table:
  // handed over together they are one read of it rather than two, and that
  // table is the only part of a snapshot large enough for the difference to
  // be the query.
  const answered = answerByImporters(coverage, [...changed.keys()].sort(codeUnitOrder), rowed, options, governing);
  // A declaration is unconditional — *if this file's text moves, retire this
  // observation* — and nothing here narrows it. It is the one thing a record
  // says that no region of any row can say.
  for (const [test, held] of answered.governed.tests) {
    for (const name of held) select(test, { kind: 'precondition', name });
  }
  for (const [test, reasons] of answered.selected) {
    for (const reason of reasons) select(test, reason);
  }
  // A name is answered when something recorded holds it: a row with probes
  // behind it, or a test declaring it. The table is asked for every changed
  // name now, so its silence about a name is no longer the same sentence as
  // *nothing measured this* — a row measured it, whether or not any test wrote
  // the name down.
  const unmatched = new Set(answered.governed.unread.filter((name) => !rowed.has(name)));
  // A file is measured when *some* name it may be held under was answered for.
  // `knownAs` exists because one file is two names — a package's own suite
  // loads `src`, every other package loads the built twin — and each name
  // selects the audience its own rows and declarations carry. A name the
  // snapshot holds nothing under selects nobody and takes nothing from the
  // name beside it. A file `knownAs` gives no name at all was asked about
  // under nothing, and is reported.
  const measured = (file: string): boolean => knownAs(file).some((name) => !unmatched.has(name));
  const unread = answered.unread.filter((name) => !measured(name)).sort(codeUnitOrder);

  const because = [...selected]
    .map(([test, via]): SelectionCause => ({ test: coverage.string(coverage.testPath.at(test)), via }))
    .sort((left, right) => codeUnitOrder(left.test, right.test));

  return {
    entered: because.map((cause) => cause.test),
    unread,
    stale: [...stale].sort(codeUnitOrder),
    because,
    readings,
  };
}

/** Every region of one row. */
function chargeAll(coverage: TestCoverageView, module: number, charge: (block: number) => void): void {
  for (let block = coverage.moduleBlocks.at(module); block < coverage.moduleBlocks.at(module + 1); block += 1) charge(block);
}

function codeUnitOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
