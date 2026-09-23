import { digestString } from '../digest.js';
import { KINDS } from './format-layout.js';
import type { TestCoverageView } from './format-view.js';
import { answerByImporters, type ExecutionNarrowingOptions, type ImporterReason } from './importers.js';
import { findModules } from './lookup.js';
import { changedLines, type LineRange } from './diff-lines.js';
import { bindsOnly } from './inert.js';
import { disownedIn } from './shadowed.js';

export type { ExecutionNarrowingOptions, ImporterReason };

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
): Pick<ExecutionNarrowing, 'entered' | 'unread' | 'because' | 'stale'> {
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

  for (const [file, ranges] of changed) {
    for (const name of knownAs(file)) {
      // Every row recorded under the name. One build reading a path is one
      // row; two builds reading it are two, each with its own crossings, and
      // the answer is all of them.
      const under = findModules(coverage, name);
      const rows = under.filter((module) => coverage.moduleInstrumented.at(module) === 1);
      // No row, or a row with nothing behind it. `instrumented: false` is the
      // build saying it never read this module — not that nothing ran in it —
      // and its zero blocks would otherwise select nobody and look like an
      // answer.
      // Every changed name is asked of the precondition table, whatever its
      // rows say. A row and a declaration answer different questions: the row
      // says which tests entered which regions of this module, the declaration
      // says the observation is void if the file's text moves at all. No
      // recorder writes the second where it can write the first — an
      // instrumented module's text is a digest on its own row
      // (`finished-files.ts`, `journal.ts`) — so what is left in the table is
      // what no row can answer: a test's own file, a configured setup file, a
      // module some other run never instrumented.
      governing.add(name);
      // Rows are per build, not per path: one file read by a node build and a
      // browser build is two rows, and `instrumented: false` on one of them is
      // that build saying it never read this module. That is no measurement,
      // so it takes nothing from the instrumented row beside it, which answers.
      if (rows.length > 0) rowed.add(name);
      for (const module of rows) {
        const first = coverage.moduleBlocks.at(module);
        const end = coverage.moduleBlocks.at(module + 1);
        const blocks = new Set<number>();
        // Everything below reads line numbers, and a line number is only a place
        // in the text it was cut from. The recorder wrote a digest of that text,
        // so whether this module's numbers mean anything here is a question the
        // snapshot can answer about itself — and one nothing used to ask.
        if (!recorded(coverage, module, name, options.sourceAt)) {
          stale.add(name);
          for (let block = first; block < end; block += 1) blocks.add(block);
        } else {
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
        }
        for (const block of blocks) {
          const reason: SelectionReason = {
            kind: 'region',
            file: name,
            name: coverage.string(coverage.blockName.at(block)),
            path: coverage.string(coverage.blockPath.at(block)),
            startLine: coverage.blockStart.at(block),
            endLine: coverage.blockEnd.at(block),
          };
          for (const test of coverage.crossings.members(coverage.blockSet.at(block))) {
            if (disowned?.(file, test, block) !== true) select(test, reason);
          }
        }
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
  };
}

/**
 * Whether this module's line ranges are coordinates in the text the diff is
 * written against.
 *
 * `modules.source` is a digest of the text the recorder cut the ranges from —
 * `probes.ts` takes it off the file on disk, beside the comment saying that is
 * what the block lines are coordinates in. So the check is the digest the
 * snapshot already holds against the digest of the text at the position the
 * snapshot names, and it costs one hash of one changed file.
 *
 * True when the caller supplied no `sourceAt`, which is the reading it has
 * always had: nothing was asked, so nothing is charged. It is the caller's
 * choice because only the caller knows how to fetch a text from a commit, and
 * the answer is worth nothing if the library guesses.
 */
function recorded(
  coverage: TestCoverageView,
  module: number,
  name: string,
  sourceAt: ExecutionNarrowingOptions['sourceAt'],
): boolean {
  if (sourceAt === undefined) return true;

  const source = sourceAt(name, coverage.commit);
  // A row for a file the position does not hold is the same disagreement: the
  // recording saw a text nothing at that commit can be.
  if (source === undefined) return false;

  return digestString(source) === coverage.string(coverage.moduleSource.at(module));
}

/**
 * The narrowest region each changed line lands in — decided per line, never per
 * file and never per hunk.
 *
 * Innermost is what makes the journal sharper than the file graph: an edit
 * inside an `onClick` is answered by the handler’s own crossings and not by the
 * module’s. Asked once for everything a diff touched, it inverts. Two hunks — an
 * added import at the top, a line inside that handler — and the module root,
 * which the import matched and which every subject in the bundle crossed, is
 * dropped for containing a block that a *different* hunk matched. One commit,
 * two edits, and the union of *all thirteen* and *one* came back as one: two of
 * `CartCard`’s three stories skipped over a change to what they render.
 *
 * Per hunk is the same bug one size down. A hunk spanning a whole function
 * covers the lines of its inner branch and the lines around them, and the branch
 * being the innermost thing in the hunk does not make the surrounding lines
 * unchanged. A line has exactly one innermost region and the answer is their
 * union, so that is the unit.
 *
 * A line on the first or last line of the narrowest region is not always that
 * region's alone. `const onClick = () => {` opens the handler and is the
 * component's text for everything before the arrow; `}, [a]);` closes it and is
 * the component's for what follows; `if (ready) {` opens the branch and holds
 * the condition, which the enclosing region evaluates. So a line that opens a
 * bracketed region — a function body, a branch, a loop body, a case, a handler —
 * or closes a function charges the enclosing region as well, and its own such
 * lines charge the next one out, until a region holds the line in its interior.
 * A one-line handler among other props is the handler's *and* the line it sits
 * on, so the tests that render the component and never click it are selected
 * when the other props change. The brace that closes a branch has nothing of
 * the enclosing region after it, and charging outwards from it would give every
 * edit to a branch's last line to the tests that never took the branch.
 *
 * Narrowest is not always innermost. On a line where one region closes and a
 * sibling opens — `} else if (score > bonus) {`, `} finally {` — the two meet
 * rather than nest, and the condition the line carries is the text of the
 * region that *opens*. Walked from the narrowest alone the chain stops at the
 * region that ends there, which opens nothing, and the region beginning on that
 * same line is never asked: an edit to the condition of an `else if` is charged
 * to the `then` branch, and every test on the else side lands in the caller's
 * skip list over a line it runs. So a region whose own text is on the line is
 * charged whether or not the chain reached it, and charges the next one out
 * from itself.
 *
 * A continuation — the rest of a block after a branch — begins at a statement
 * and ends where its block ends, so its lines are its own and it never charges
 * outwards. A resume, the rest of an expression after an `await`, shares its
 * first line with the text before the `await`, which is the region around it:
 * when that region spans the same lines it is charged beside the resume, and
 * when it is wider — a function whose body the line is inside — the resume's
 * first line charges it, however many awaits the line holds.
 *
 * Lines are all the snapshot holds, so a region that begins at its first
 * statement rather than at a bracket — a `case` body, a brace-less `if` — is
 * read as sharing its first line with the region around it, whether or not the
 * label or the condition is on that line. That is over-selection, the safe
 * direction, and the price of not recording where on the line a region starts.
 *
 * Narrowest is measured over regions that have source. A synthesized region —
 * the `else` nobody wrote, placed at the closing brace of the `if` — spans zero
 * lines, so it would be the narrowest thing on its line every time, and the
 * tests that took the written branch would be dropped over an edit to the line
 * that closes it. It is a region the line is in, so its crossings are added; it
 * is not a measure of how far the edit reaches, so it never decides alone.
 *
 * A line in no recorded region falls back to the whole module. That is the file
 * having grown past what the snapshot saw, and the module’s own crossings are
 * the widest honest answer.
 */
function blocksAround(
  coverage: TestCoverageView,
  first: number,
  end: number,
  range: LineRange,
): readonly number[] {
  const found = new Set<number>();

  for (let line = range.start; line <= range.end; line += 1) {
    // Every region with source the line is in, narrowest first. Regions that
    // hold one line mostly nest, so this is the chain from the line outwards —
    // except where two of them meet on it, and then the wider one begins where
    // the narrower ends and neither is inside the other.
    const around: number[] = [];
    for (let block = first; block < end; block += 1) {
      const from = coverage.blockStart.at(block);
      const to = Math.max(from, coverage.blockEnd.at(block));
      if (from > line || to < line) continue;
      if (coverage.blockSource.at(block) === 1) around.push(block);
      else found.add(block);
    }
    if (around.length === 0) {
      // Nothing recorded covers this line, so nothing about the module can be
      // ruled out from it.
      for (let block = first; block < end; block += 1) found.add(block);
      return [...found];
    }
    around.sort((left, right) => span(coverage, left) - span(coverage, right));
    let index = 0;
    let outwards = true;
    while (index < around.length) {
      // Regions of one span over one line are the same lines: all are charged,
      // and any of them whose text here sits beside the next region's reaches
      // that region.
      const width = span(coverage, around[index]!);
      let next = index;
      while (next < around.length && span(coverage, around[next]!) === width) next += 1;
      const group = around.slice(index, next);
      const besideResume = group.every((block) => KINDS[coverage.blockKind.at(block)] === 'resume');
      const shares = group.some((block) => sharesLine(coverage, block, line, besideResume));
      // Charged when the walk reached it, and charged when its own text is on
      // this line whether or not the walk reached it. The second is the sibling
      // meeting: the region the line closes does not reach the one it opens,
      // and the one it opens holds the line all the same.
      if (outwards || shares) for (const block of group) found.add(block);
      outwards = shares;
      index = next;
    }
    if (found.size === end - first) break;
  }

  return [...found];
}

function span(coverage: TestCoverageView, block: number): number {
  return coverage.blockEnd.at(block) - coverage.blockStart.at(block);
}

/**
 * Whether the region's text on this line sits beside text of a wider region
 * around it. `unaccompanied` says no region of the same lines but another kind
 * is charged beside this one, which for a resume is whether the text before its
 * `await` is the wider region's rather than a sibling's already charged.
 */
function sharesLine(coverage: TestCoverageView, block: number, line: number, unaccompanied: boolean): boolean {
  const kind = KINDS[coverage.blockKind.at(block)]!;
  if (kind === 'module' || kind === 'continuation') return false;
  if (kind === 'resume') return unaccompanied && coverage.blockStart.at(block) === line;
  if (coverage.blockStart.at(block) === line) return true;
  return kind === 'function' && coverage.blockEnd.at(block) === line;
}

function codeUnitOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
