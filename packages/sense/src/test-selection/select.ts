import { KINDS, type TestCoverageView } from './format.js';
import { answerByImporters, type ExecutionNarrowingOptions, type ImporterReason } from './importers.js';
import { findModule, testsGovernedBy } from './lookup.js';
import { changedLines, type LineRange } from './diff-lines.js';

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
   * Changed paths nothing recorded holds: no row, no precondition, and no
   * place in the graph when the caller handed one over.
   *
   * The record decides what a change reaches. A module nobody executed has no
   * row and selects nobody, and so does a stylesheet nothing recorded imports.
   * What is listed here is different: a file the sense database has never
   * heard of — a README, a fixture the tests read with `fs`, a script they
   * spawn, a file outside the directories the scan was pointed at. It is a
   * report, not a widening: a suite that depends on such a file declares it
   * as a precondition, and it stops appearing here.
   *
   * Empty is the ordinary state.
   */
  readonly unread: readonly string[];

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
 * of `asset` imports from a changed file no probe can sit in to the module
 * whose row answered for it, which is how `ExecutionNarrowingOptions.relations`
 * answers a stylesheet.
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
    if (coverage.testComplete[test] === 1) whole.push(coverage.string(coverage.testPath[test]!));
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
 * regions its changed lines fell in, from every such row. A name with no row, or
 * a row the build could not read, is asked of the preconditions instead, and
 * of the graph, then returned as unread under the name the diff gave it when
 * none of those holds it.
 */
function readDiff(
  coverage: TestCoverageView,
  diff: string,
  options: ExecutionNarrowingOptions,
): Pick<ExecutionNarrowing, 'entered' | 'unread' | 'because'> {
  const knownAs = options.knownAs ?? ((file: string): readonly string[] => [file]);
  const selected = new Map<number, SelectionReason[]>();
  const select = (test: number, reason: SelectionReason): void => {
    const reasons = selected.get(test) ?? [];
    reasons.push(reason);
    selected.set(test, reasons);
  };
  const changed = changedLines(diff);
  const governing = new Set<string>();

  for (const [file, ranges] of changed) {
    for (const name of knownAs(file)) {
      const module = findModule(coverage, name);
      // No row, or a row with nothing behind it. `instrumented: false` is the
      // build saying it never read this module — not that nothing ran in it —
      // and its zero blocks would otherwise select nobody and look like an
      // answer.
      if (module === undefined || coverage.moduleInstrumented[module] !== 1) {
        governing.add(name);
        continue;
      }
      const first = coverage.moduleBlocks[module]!;
      const end = coverage.moduleBlocks[module + 1]!;
      const blocks = new Set<number>();
      // A file the diff names without lines — a binary, a rename, a mode — is
      // every region of it.
      if (ranges.length === 0) for (let block = first; block < end; block += 1) blocks.add(block);
      for (const range of ranges) {
        for (const block of blocksAround(coverage, first, end, range)) blocks.add(block);
      }
      for (const block of blocks) {
        const reason: SelectionReason = {
          kind: 'region',
          file: name,
          name: coverage.string(coverage.blockName[block]!),
          path: coverage.string(coverage.blockPath[block]!),
          startLine: coverage.blockStart[block]!,
          endLine: coverage.blockEnd[block]!,
        };
        for (
          let crossing = coverage.blockTests[block]!;
          crossing < coverage.blockTests[block + 1]!;
          crossing += 1
        ) {
          select(coverage.crossingTest[crossing]!, reason);
        }
      }
    }
  }

  const governed = testsGovernedBy(coverage, [...governing]);
  for (const [test, names] of governed.tests) {
    for (const name of names) select(test, { kind: 'precondition', name });
  }
  // Every changed file is asked of the graph as well, which answers only a
  // file no probe can sit in, from the module that imports it; a module with
  // no row is dead there too. A file is *unread* only when nothing answered
  // for any of its names, and a name with a row is never in `governed.unread`.
  const answered = answerByImporters(coverage, [...changed.keys()].sort(codeUnitOrder), options);
  for (const [test, reasons] of answered.selected) {
    for (const reason of reasons) select(test, reason);
  }
  const unmatched = new Set(governed.unread);
  const unread = answered.unread
    .filter((file) => knownAs(file).every((name) => unmatched.has(name)))
    .sort(codeUnitOrder);

  const because = [...selected]
    .map(([test, via]): SelectionCause => ({ test: coverage.string(coverage.testPath[test]!), via }))
    .sort((left, right) => codeUnitOrder(left.test, right.test));

  return {
    entered: because.map((cause) => cause.test),
    unread,
    because,
  };
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
    // hold one line nest, so this is the chain from the line outwards.
    const around: number[] = [];
    for (let block = first; block < end; block += 1) {
      const from = coverage.blockStart[block]!;
      const to = Math.max(from, coverage.blockEnd[block]!);
      if (from > line || to < line) continue;
      if (coverage.blockSource[block] === 1) around.push(block);
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
    while (index < around.length && outwards) {
      // Regions of one span over one line are the same lines: all are charged,
      // and any of them whose text here sits beside the next region's reaches
      // that region.
      const width = span(coverage, around[index]!);
      let next = index;
      while (next < around.length && span(coverage, around[next]!) === width) next += 1;
      const group = around.slice(index, next);
      for (const block of group) found.add(block);
      const besideResume = group.every((block) => KINDS[coverage.blockKind[block]!] === 'resume');
      outwards = group.some((block) => sharesLine(coverage, block, line, besideResume));
      index = next;
    }
    if (found.size === end - first) break;
  }

  return [...found];
}

function span(coverage: TestCoverageView, block: number): number {
  return coverage.blockEnd[block]! - coverage.blockStart[block]!;
}

/**
 * Whether the region's text on this line sits beside text of a wider region
 * around it. `unaccompanied` says no region of the same lines but another kind
 * is charged beside this one, which for a resume is whether the text before its
 * `await` is the wider region's rather than a sibling's already charged.
 */
function sharesLine(coverage: TestCoverageView, block: number, line: number, unaccompanied: boolean): boolean {
  const kind = KINDS[coverage.blockKind[block]!]!;
  if (kind === 'module' || kind === 'continuation') return false;
  if (kind === 'resume') return unaccompanied && coverage.blockStart[block] === line;
  if (coverage.blockStart[block] === line) return true;
  return kind === 'function' && coverage.blockEnd[block] === line;
}

function codeUnitOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
