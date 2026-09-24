/**
 * Who goes here: the tests that crossed one place in the source.
 *
 * [`select.ts`](./select.ts) asks the snapshot a question whose input is a
 * diff, and hands back a set to skip. This asks the same columns a question
 * whose input is a *point* — a file, a line, a declaration, a branch inside one
 * — and hands back the tests that were observed there. The two are not variants
 * of one query. A selection is a decision about work, is allowed to be wider
 * than the truth, and is read by a runner; a point query is a statement about
 * evidence, is worth nothing if it is wider than the truth, and is read by
 * somebody about to edit the line.
 *
 * ## It is not a diff with one hunk
 *
 * The temptation is to synthesize a one-line diff and call `narrowByExecution`.
 * That answers a different question and answers it wrong in the direction that
 * matters here. `blocksAround` charges outwards from a line onto the regions
 * around it — deliberately, because a line that opens a handler is also the
 * component's text and a selection that missed those tests would skip work it
 * should have run. Charged into an answer to *who enters this branch*, the same
 * rule returns every test that rendered the component and never took the
 * branch, and there is nothing in the result to tell the two apart. Selection
 * over-includes on purpose. An answer may not.
 *
 * So the resolution here is innermost and exact: the narrowest recorded regions
 * with source that hold the line, the region a declaration name addresses, the
 * region a branch path addresses. Nothing is charged outwards, and a point the
 * snapshot has no region for is reported as unrecorded rather than widened to
 * the module.
 *
 * ## The direction is the one the file is stored in
 *
 * Nothing is scanned and nothing is inverted. `moduleBlocks` cuts a module's
 * regions out of the region columns, `blockSet` names the pool entry for each,
 * and `crossings.members` decompresses that one run — so the cost is a binary
 * search for the path ([`lookup.ts`](./lookup.ts)), the regions of one module,
 * and one pool run per matched region. A point in a 200,000-module snapshot
 * costs what a point in a small one costs.
 *
 * That is the region-to-tests direction, which
 * [ADR-0061](../../../../docs/context/adr/0061-a-crossing-relation-is-interned-not-owned.md)
 * holds is the one the pool answers without a join. The other direction — every
 * module one test entered — has no index and is a scan, which is why hop
 * distance is not computed here and is left to `distanceFromView` over
 * {@link SourceAudience.because}, where a caller who wants it pays for it
 * knowingly.
 *
 * ## What a test is, here
 *
 * A test file. The snapshot's test table is keyed by path, so *which tests* is
 * answered at the granularity the record holds and no finer. Individual test
 * names live in the per-case sidecar every run writes beside it, and
 * [`reverse.ts`](./reverse.ts) is the query over that. A caller wanting names
 * asks this first to find out whether anything reached the point at all, and
 * asks that second.
 *
 * ## No distance is invented
 *
 * There is no depth on a crossing and there will not be one:
 * [ADR-0056](../../../../docs/context/adr/0056-a-crossing-is-a-place-not-a-stack.md)
 * forecloses a maintained call stack, and `cases.ts` records every crossing at
 * zero for that reason. A point query that sorted its answer by a fabricated
 * number would be sorting by nothing.
 */

import type { BlockKind } from '../instrument/index.js';
import { KINDS } from './format-layout.js';
import type { TestCoverageView } from './format-view.js';
import { askCoverageFile } from './coverage-file.js';
import { distanceFromView, type DistanceOptions, type TestDistance } from './distance.js';
import { findModules } from './lookup.js';
import type { SelectionCause, SelectionReason } from './select.js';
import { NO_LINE } from './written-lines.js';

/**
 * Where to ask.
 *
 * `file` alone is the whole module: every region it holds, and therefore every
 * test that entered any of it. The other three narrow it, and at most one of
 * `line` and `branch` may be given — they address a region two different ways
 * and a caller that means both means neither.
 *
 * `function` is a declaration name path as the journal writes it —
 * `Cart/render`, `applyTier/reduce.arg0` — and matches the region of that
 * declaration itself. Given beside `branch` it scopes the branch to that
 * declaration, which is the only way a structural path like `if#0/else` is
 * unique: the path is unique *within* a declaration and repeats across a file.
 */
export interface SourcePoint {
  /** Repository-relative path, under the name the snapshot holds the module by. */
  readonly file: string;
  /** One-based source line, in the text the snapshot recorded. */
  readonly line?: number;
  /** Declaration name path, exactly as recorded. */
  readonly function?: string;
  /** Structural path inside a declaration, exactly as recorded: `if#0/else`. */
  readonly branch?: string;
}

/** One region the point resolved to. */
export interface SourceRegion {
  readonly kind: BlockKind;
  /** Declaration name path. */
  readonly name: string;
  /** Structural path inside that declaration; `entry` for the declaration itself. */
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  /** How many test files crossed this region. */
  readonly entered: number;
}

/** One test file observed at the point. */
export interface SourceAudienceTest {
  readonly test: string;
  /**
   * Whether this test's own recording is whole.
   *
   * An incomplete row is a test whose journal did not arrive or could not be
   * placed. It is reported rather than dropped: it was observed here, and what
   * it cannot be used for is deciding that something *else* was not.
   */
  readonly complete: boolean;
  /** Which of the matched regions it crossed, by their index in {@link SourceAudience.regions}. */
  readonly regions: readonly number[];
}

/** What the snapshot says about one place in the source. */
export interface SourceAudience {
  /** The path as asked. */
  readonly file: string;
  /**
   * Whether the snapshot holds an instrumented row for this file.
   *
   * False is three different things and the caller has to be told which, so the
   * three are separated: no row at all, a row the build never read
   * (`instrumented: false`), and a row whose regions do not hold the point.
   * {@link SourceAudience.because} is empty in all three and only this field and
   * {@link SourceAudience.regions} tell them apart — a file with rows and no
   * matched region is `recorded: true` with `regions: []`.
   */
  readonly recorded: boolean;
  /** The regions the point resolved to, narrowest first. */
  readonly regions: readonly SourceRegion[];
  /** Every test file that crossed at least one of them, in code-unit order. */
  readonly tests: readonly SourceAudienceTest[];
  /**
   * Test files that had a matched region loaded when they began and entered
   * none of it.
   *
   * A different fact from an empty answer and a useful one: the code was in the
   * process and nothing ran it. That is a dead branch, a guard nobody tripped,
   * or a test that imports the module for something else.
   */
  readonly loaded: readonly string[];
  /**
   * The same answer in the shape `distanceFromView` consumes.
   *
   * A point is a change that has not been made yet, so the reasons are the
   * regions it resolved to and the question *how far is each of these tests
   * from here* is the one `distance.ts` already answers. It is not answered
   * here because it costs a pass over every module in the file to learn what
   * each test entered, which is the cost this module was written to avoid
   * paying by default.
   */
  readonly because: readonly SelectionCause[];
}

/**
 * Ask one place in the source who goes there.
 *
 * Throws when the point is self-contradictory — `line` beside `branch` — and
 * answers rather than throwing for everything else, including a file the
 * snapshot has never heard of. A question about an unrecorded file has an
 * answer, and the answer is *nothing was observed and here is which kind of
 * nothing*.
 */
export function testsReachingFromView(
  coverage: TestCoverageView,
  point: SourcePoint,
): SourceAudience {
  if (point.line !== undefined && point.branch !== undefined) {
    throw new Error('`line` and `branch` address a region two ways; give one');
  }
  if (point.line !== undefined && (!Number.isInteger(point.line) || point.line < 1)) {
    throw new Error('`line` must be a positive integer');
  }

  const rows = findModules(coverage, point.file).filter(
    (module) => coverage.moduleInstrumented.at(module) === 1,
  );
  if (rows.length === 0) {
    return { file: point.file, recorded: false, regions: [], tests: [], loaded: [], because: [] };
  }

  const matched: number[] = [];
  for (const module of rows) {
    const first = coverage.moduleBlocks.at(module);
    const end = coverage.moduleBlocks.at(module + 1);
    for (const block of resolve(coverage, first, end, point)) {
      // A region the transform wrote without an origin is no place in the
      // file, and an answer here is a list of places.
      if (coverage.blockStart.at(block) !== NO_LINE) matched.push(block);
    }
  }
  matched.sort((left, right) => span(coverage, left) - span(coverage, right));

  const regions: SourceRegion[] = [];
  const crossed = new Map<number, number[]>();
  const loadedOnly = new Set<number>();
  for (const [at, block] of matched.entries()) {
    const members = coverage.crossings.members(coverage.blockSet.at(block));
    for (const test of members) {
      const already = crossed.get(test);
      if (already === undefined) crossed.set(test, [at]);
      else already.push(at);
    }
    for (const test of coverage.crossings.members(coverage.blockLoadedSet.at(block))) {
      loadedOnly.add(test);
    }
    regions.push({
      kind: KINDS[coverage.blockKind.at(block)]!,
      name: coverage.string(coverage.blockName.at(block)),
      path: coverage.string(coverage.blockPath.at(block)),
      startLine: coverage.blockStart.at(block),
      endLine: coverage.blockEnd.at(block),
      entered: members.length,
    });
  }

  const tests = [...crossed]
    .map(([test, at]) => ({
      test: coverage.string(coverage.testPath.at(test)),
      complete: coverage.testComplete.at(test) === 1,
      regions: at,
    }))
    .sort((left, right) => codeUnitOrder(left.test, right.test));

  const loaded = [...loadedOnly]
    .filter((test) => !crossed.has(test))
    .map((test) => coverage.string(coverage.testPath.at(test)))
    .sort(codeUnitOrder);

  const because = tests.map((test): SelectionCause => ({
    test: test.test,
    via: test.regions.map((at): SelectionReason => ({
      kind: 'region',
      file: point.file,
      name: regions[at]!.name,
      path: regions[at]!.path,
      startLine: regions[at]!.startLine,
      endLine: regions[at]!.endLine,
    })),
  }));

  return { file: point.file, recorded: true, regions, tests, loaded, because };
}

/**
 * The regions of one module row the point addresses.
 *
 * Innermost for a line, and innermost is measured over regions that have
 * source: a synthesized region — the `else` nobody wrote — spans zero lines and
 * would be the narrowest thing on its line every time, so it is not a candidate
 * for *where is this line*. That is the same exclusion `blocksAround` makes and
 * it is made here for the opposite reason: there it stops a zero-span region
 * from deciding how far an edit reaches, here it stops one from standing in for
 * a line somebody can point at.
 *
 * A region that strictly contains another matching one is dropped. Two regions
 * of exactly the same extent are both kept — they are the same lines, and
 * picking one of them would be picking by a tiebreak nothing recorded.
 */
function resolve(
  coverage: TestCoverageView,
  first: number,
  end: number,
  point: SourcePoint,
): readonly number[] {
  const kindOf = (block: number): BlockKind => KINDS[coverage.blockKind.at(block)]!;
  const nameOf = (block: number): string => coverage.string(coverage.blockName.at(block));
  const pathOf = (block: number): string => coverage.string(coverage.blockPath.at(block));

  if (point.branch !== undefined) {
    const found: number[] = [];
    for (let block = first; block < end; block += 1) {
      if (pathOf(block) !== point.branch) continue;
      if (point.function !== undefined && nameOf(block) !== point.function) continue;
      found.push(block);
    }
    return found;
  }

  if (point.function !== undefined && point.line === undefined) {
    const found: number[] = [];
    for (let block = first; block < end; block += 1) {
      // The declaration's own entry region, not the regions inside it:
      // entering the function is crossing the region the walker opens at its
      // head under the structural path `entry`, and its branches are separate
      // questions with separate answers.
      if (kindOf(block) === 'function' && nameOf(block) === point.function && pathOf(block) === ENTRY) {
        found.push(block);
      }
    }
    return found;
  }

  if (point.line === undefined) {
    const found: number[] = [];
    for (let block = first; block < end; block += 1) found.push(block);
    return found;
  }

  const line = point.line;
  const holding: number[] = [];
  for (let block = first; block < end; block += 1) {
    if (coverage.blockSource.at(block) !== 1) continue;
    if (point.function !== undefined && nameOf(block) !== point.function) continue;
    const from = coverage.blockStart.at(block);
    const to = Math.max(from, coverage.blockEnd.at(block));
    if (from <= line && line <= to) holding.push(block);
  }
  return holding.filter((block) =>
    !holding.some((other) =>
      other !== block &&
      coverage.blockStart.at(block) <= coverage.blockStart.at(other) &&
      coverage.blockEnd.at(block) >= coverage.blockEnd.at(other) &&
      span(coverage, other) < span(coverage, block),
    ),
  );
}

/** The structural path the walker opens a declaration's own region under. */
const ENTRY = 'entry';

function span(coverage: TestCoverageView, block: number): number {
  return coverage.blockEnd.at(block) - coverage.blockStart.at(block);
}

function codeUnitOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Which tests were observed at one place in the source.
 *
 * The question a selection cannot be asked: not *what should run because
 * something changed*, but *who goes here*, about a file, a line, a declaration
 * or a branch that nobody has touched. See
 * the file docblock above for why it is not a one-line diff.
 *
 * Opens the snapshot rather than decoding it. The answer costs a binary search
 * for the path, the regions of that one module, and one pool run per region the
 * point resolved to, so it is the same cost in a repository of two hundred
 * thousand modules as in a repository of ten.
 */
export async function testsReaching(
  file: string,
  point: SourcePoint,
): Promise<SourceAudience> {
  return askCoverageFile(file, (coverage) => testsReachingFromView(coverage, point));
}

/**
 * The same answer, and how far each test is from the point in import hops.
 *
 * Separate from {@link testsReaching} because it is a different cost, not a
 * different option. The region-to-tests direction is an address; the
 * test-to-modules direction the walk needs has no index
 * ([ADR-0061](../../../../docs/context/adr/0061-a-crossing-relation-is-interned-not-owned.md)),
 * so placing the answer costs a pass over every region in the snapshot. A
 * caller that wants hops asks for them here and pays for them here.
 *
 * `options.relations` is required in practice: without a graph every test comes
 * back `unmeasured`, which is the honest answer and not a useful one.
 */
export async function distanceToSource(
  file: string,
  point: SourcePoint,
  options: DistanceOptions = {},
): Promise<{ readonly audience: SourceAudience; readonly distances: readonly TestDistance[] }> {
  return askCoverageFile(file, (coverage) => {
    const audience = testsReachingFromView(coverage, point);
    return {
      audience,
      distances: distanceFromView(
        coverage,
        { whole: [], entered: audience.tests.map((test) => test.test), unread: [], stale: [], because: audience.because },
        options,
      ),
    };
  });
}
