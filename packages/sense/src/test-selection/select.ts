import type { TestCoverageView } from './format.js';

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
   * Changed files the snapshot holds nothing about, and therefore speaks for
   * nobody over.
   *
   * A journal indexes the modules of the build that carried the probes. A
   * stylesheet, a JSON fixture, a server-only module, a file added since the
   * recording — none of them have a row, and every one of them can change what a
   * subject paints. Their absence from `entered` is the snapshot having no
   * opinion, and a caller reading it as *nobody entered this* skips a suite over
   * a file it never measured.
   *
   * Empty is the ordinary state and means every changed path was one the journal
   * could answer for.
   */
  readonly unread: readonly string[];
}

/** Both halves of the question, from one pass over the same columns. */
export function narrowByExecutionFromView(
  coverage: TestCoverageView,
  diff: string,
): ExecutionNarrowing {
  const whole: string[] = [];
  for (let test = 0; test < coverage.testPath.length; test += 1) {
    if (coverage.testComplete[test] === 1) whole.push(coverage.string(coverage.testPath[test]!));
  }

  return { whole: whole.sort(codeUnitOrder), ...readDiff(coverage, diff) };
}

/** Query the binary columns without materializing the coverage graph. */
export function selectTestFilesFromView(
  coverage: TestCoverageView,
  diff: string,
): readonly string[] {
  return readDiff(coverage, diff).entered;
}

function readDiff(
  coverage: TestCoverageView,
  diff: string,
): { readonly entered: readonly string[]; readonly unread: readonly string[] } {
  const selected = new Set<number>();
  const governing: string[] = [];

  for (const [file, ranges] of changedLines(diff)) {
    const module = findModule(coverage, file);
    if (module === undefined) {
      governing.push(file);
      continue;
    }
    const first = coverage.moduleBlocks[module]!;
    const end = coverage.moduleBlocks[module + 1]!;
    for (const range of ranges) {
      for (const block of blocksAround(coverage, first, end, range)) {
        for (
          let crossing = coverage.blockTests[block]!;
          crossing < coverage.blockTests[block + 1]!;
          crossing += 1
        ) {
          selected.add(coverage.crossingTest[crossing]!);
        }
      }
    }
  }

  const governed = testsGovernedBy(coverage, governing);
  for (const test of governed.tests) selected.add(test);

  return {
    entered: [...selected]
      .map((test) => coverage.string(coverage.testPath[test]!))
      .sort(codeUnitOrder),
    unread: governed.unread,
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
    let narrowest = Number.POSITIVE_INFINITY;
    for (let block = first; block < end; block += 1) {
      const from = coverage.blockStart[block]!;
      const to = Math.max(from, coverage.blockEnd[block]!);
      if (from > line || to < line) continue;
      narrowest = Math.min(narrowest, to - from);
    }
    if (narrowest === Number.POSITIVE_INFINITY) {
      // Nothing recorded covers this line, so nothing about the module can be
      // ruled out from it.
      for (let block = first; block < end; block += 1) found.add(block);
      return [...found];
    }
    for (let block = first; block < end; block += 1) {
      const from = coverage.blockStart[block]!;
      const to = Math.max(from, coverage.blockEnd[block]!);
      if (from <= line && to >= line && to - from === narrowest) found.add(block);
    }
    if (found.size === end - first) break;
  }

  return [...found];
}

/**
 * Tests a changed file governs, and the files nothing in the snapshot answers
 * for.
 *
 * Coverage records where execution *entered* a module, so a file nothing enters
 * has no module row however much it decides. A test file is one: it is its own
 * recorded precondition, and nothing enters it. A declared `preconditions` entry
 * — runner configuration, a fixture, an environment file — is another, and it is
 * every test’s. Read as "no module, no tests", a commit that edits a test
 * selected nothing and the new test never ran; a commit that changed the runner
 * config selected nothing and every test that config governs never ran. Both are
 * silent: the selector returns an empty list and the run is green.
 *
 * A file that is neither is not a file that governs nothing. It is a file the
 * snapshot was never told about, and it is returned as `unread` rather than
 * dropped so a caller can decline to narrow instead of narrowing on a blank.
 */
function testsGovernedBy(
  coverage: TestCoverageView,
  files: readonly string[],
): { readonly tests: readonly number[]; readonly unread: readonly string[] } {
  if (files.length === 0) return { tests: [], unread: [] };
  const wanted = new Set(files);
  const matched = new Set<string>();
  const tests: number[] = [];

  for (let test = 0; test < coverage.testPath.length; test += 1) {
    let governs = false;
    for (
      let input = coverage.testPreconditions[test]!;
      input < coverage.testPreconditions[test + 1]!;
      input += 1
    ) {
      const name = coverage.string(coverage.preconditionName[input]!);
      if (!wanted.has(name)) continue;
      matched.add(name);
      governs = true;
    }
    if (governs) tests.push(test);
  }

  return {
    tests,
    unread: files.filter((file) => !matched.has(file)).sort(codeUnitOrder),
  };
}

/** Module rows are code-unit sorted when the merged snapshot is written. */
function findModule(coverage: TestCoverageView, file: string): number | undefined {
  let low = 0;
  let high = coverage.modulePath.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = coverage.string(coverage.modulePath[middle]!);
    if (candidate === file) return middle;
    if (candidate < file) low = middle + 1;
    else high = middle - 1;
  }
  return undefined;
}

interface LineRange {
  readonly start: number;
  readonly end: number;
}

/**
 * The lines a diff actually changed, in the coordinates the journal is indexed
 * by.
 *
 * Two things a hunk header does not say, and both of them decide a run.
 *
 * **The span is not the change.** `@@ -48,7 @@` is seven lines of which one may
 * be edited; the other six are context, printed so a human can find the place.
 * Read as a range, an edit to a single `onClick` claims the six lines around it
 * — the end of the component body — and every subject that ever rendered the
 * component has entered one of them. The narrowing that separates *the effect
 * every story runs* from *the handler one story clicks* survives only if a
 * context line is not a change.
 *
 * **A deletion still has coordinates.** `+++ /dev/null` is the whole header on
 * the new side, and the hunks under it are entirely old lines — the side this
 * reads. Keyed off `+++` alone, a commit that removed a module every subject
 * crosses named no file and contributed nothing.
 *
 * An insertion is charged to the lines on both sides of the gap it opens. The
 * new text is between them and belongs to whichever region spans it, and that is
 * knowable from the old file only as *one of these two*.
 */
function changedLines(diff: string): ReadonlyMap<string, readonly LineRange[]> {
  const byFile = new Map<string, LineRange[]>();
  let removed: string | undefined;
  let file: string | undefined;
  let old = 0;
  // A context line is one line of body that counts against both sides, so the
  // body ends when both are spent — not after `old + new` lines, which counts
  // every context line twice and eats the next file's header.
  let oldLeft = 0;
  let newLeft = 0;
  let replacing = false;
  let hunk: LineRange | undefined;
  let marked = false;

  const mark = (from: number, to: number): void => {
    if (file === undefined) return;
    const ranges = byFile.get(file) ?? [];
    ranges.push({ start: Math.max(from, 1), end: Math.max(to, 1) });
    byFile.set(file, ranges);
    marked = true;
  };

  // A hunk whose body says nothing is a hunk that must widen to its header. It
  // is not a shape git writes, and a reader that answered `no lines changed` to
  // one would rule subjects out of a diff it failed to parse.
  const close = (): void => {
    if (hunk !== undefined && !marked) mark(hunk.start, hunk.end);
    hunk = undefined;
  };

  for (const line of diff.split('\n')) {
    if (oldLeft > 0 || newLeft > 0) {
      if (line.startsWith('-')) {
        mark(old, old);
        old += 1;
        replacing = true;
        oldLeft -= 1;
      } else if (line.startsWith('+')) {
        newLeft -= 1;
        // Within one run, git writes every removal before the additions that
        // replace them, and there is no correspondence between the two counts —
        // one line can become three. Every addition in a run that removed
        // something rewrites the span those removals already charged; three
        // lines replacing an `onClick` are that handler and not the two lines
        // after it. An addition in a run that removed nothing opens a gap, and
        // the new text belongs to whichever region spans the old lines around
        // it.
        if (!replacing) mark(old - 1, old);
      } else if (!line.startsWith('\\')) {
        old += 1;
        replacing = false;
        oldLeft -= 1;
        newLeft -= 1;
      }
      if (oldLeft <= 0 && newLeft <= 0) close();
      continue;
    }

    close();

    if (line.startsWith('--- ')) {
      removed = diffPath(line.slice(4));
      continue;
    }
    if (line.startsWith('+++ ')) {
      file = diffPath(line.slice(4)) ?? removed;
      continue;
    }
    if (file === undefined || !line.startsWith('@@ ')) continue;

    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (match === null) continue;

    old = Number(match[1]);
    const count = Number(match[2] ?? '1');
    oldLeft = count;
    newLeft = Number(match[4] ?? '1');
    replacing = false;
    marked = false;
    hunk = { start: old, end: old + Math.max(count, 1) - 1 };
  }

  close();

  return byFile;
}

function diffPath(value: string): string | undefined {
  const path = value.split('\t')[0];
  if (path === undefined || path === '/dev/null') return undefined;
  return path.startsWith('b/') || path.startsWith('a/') ? path.slice(2) : path;
}

function codeUnitOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
