/**
 * Where a changed line lands in a module's recorded regions, and the reason a
 * region selected a test.
 *
 * Its own file because two readers ask it: the diff's lines, and the lines the
 * parser says read a changed value (`reading.ts`).
 */

import { KINDS } from './format-layout.js';
import type { TestCoverageView } from './format-view.js';
import type { LineRange } from './diff-lines.js';
import { NO_LINE } from './written-lines.js';

/** The `region` reason for one recorded block of the module held under `file`. */
export function regionOf(coverage: TestCoverageView, file: string, block: number) {
  return {
    kind: 'region' as const,
    file,
    name: coverage.string(coverage.blockName.at(block)),
    path: coverage.string(coverage.blockPath.at(block)),
    startLine: coverage.blockStart.at(block),
    endLine: coverage.blockEnd.at(block),
  };
}

/** Whether the block is the module's own region, which is every test that loaded the file. */
export function moduleRegion(coverage: TestCoverageView, block: number): boolean {
  return KINDS[coverage.blockKind.at(block)] === 'module';
}

/**
 * Whether the gap an insertion opened lies inside a recorded region other than
 * the module's: one that holds the old lines on both sides of it.
 *
 * The line path charges both neighbours of a gap, because it cannot tell text
 * added inside a function's closing lines from text added after them. A parsed
 * reading can ask the regions instead. A gap it cannot place — at the top of
 * the file, where the two sides are one line — is inside.
 */
export function gapInside(coverage: TestCoverageView, first: number, end: number, range: LineRange): boolean {
  if (range.end !== range.start + 1) return true;
  for (let block = first; block < end; block += 1) {
    const from = coverage.blockStart.at(block);
    if (from === NO_LINE || moduleRegion(coverage, block)) continue;
    if (from <= range.start && coverage.blockEnd.at(block) >= range.end) return true;
  }
  return false;
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
export function blocksAround(
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
      // A region the transform wrote without an origin is on no line, so no
      // line is in it and it never stands for one.
      if (from === NO_LINE) continue;
      const to = Math.max(from, coverage.blockEnd.at(block));
      if (from > line || to < line) continue;
      if (coverage.blockSource.at(block) === 1) around.push(block);
      else found.add(block);
    }
    if (around.length === 0) {
      // Nothing recorded covers this line, so nothing about the module can be
      // ruled out from it. The module root, which every loader crossed, stands
      // for the regions with no line.
      for (let block = first; block < end; block += 1) {
        if (coverage.blockStart.at(block) !== NO_LINE) found.add(block);
      }
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
 *
 * A resume spans the awaited expression, and all of it — an argument on a line
 * of its own, an element of `Promise.all([…])`, a `.then` chained on — is
 * evaluated before the await settles, by whoever reached the `await`. So every
 * line of it is the wider region's too, not only the first: a test whose await
 * rejected ran that text and never resumed.
 */
function sharesLine(coverage: TestCoverageView, block: number, line: number, unaccompanied: boolean): boolean {
  const kind = KINDS[coverage.blockKind.at(block)]!;
  if (kind === 'module' || kind === 'continuation') return false;
  if (kind === 'resume') return unaccompanied;
  if (coverage.blockStart.at(block) === line) return true;
  return kind === 'function' && coverage.blockEnd.at(block) === line;
}
