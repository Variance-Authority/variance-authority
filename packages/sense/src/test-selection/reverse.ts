import type { Relations } from '@variance-authority/core/relate';
import { shadowedFor, type ShadowedFor } from './shadowed.js';

export interface ExecutionTest {
  /** Stable producer identity; names are not required to be unique. */
  readonly id: string;
  readonly file: string;
  readonly name: string;
}

export interface ExecutionCrossing {
  /** Index into `ExecutionIndex.tests`. */
  readonly test: number;
  /** Observed call-stack depth from the test to this region. */
  readonly distance: number;
  /**
   * True when the region was entered while its module was evaluating, rather
   * than because the test called into it.
   *
   * A module initializes once per realm and its initialization is attributed to
   * every test that consumed the module, which is what
   * [`selecting.md`](../../../../docs/selecting.md) asks for: over-include, so a
   * change cannot skip a test. A reader asking what a test *exercised* needs the
   * opposite direction, and cannot recover it from a crossing that does not say
   * which of the two it was. `CoverageBlock.loadedBy` records the same fact for
   * a whole test file; this is its per-case spelling. Absent means the producer
   * does not distinguish them, which is read as an ordinary crossing.
   */
  readonly loaded?: boolean;
}

export interface ExecutionBlock {
  readonly kind: string;
  readonly name: string;
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  /** False for a synthesized region with no source of its own. */
  readonly source: boolean;
  readonly crossings: readonly ExecutionCrossing[];
}

export interface ExecutionModule {
  readonly file: string;
  readonly blocks: readonly ExecutionBlock[];
}

/** Runner-independent execution data supplied by a collector or editor integration. */
export interface ExecutionIndex {
  readonly tests: readonly ExecutionTest[];
  readonly modules: readonly ExecutionModule[];
}

export type SourceTestTarget =
  | { readonly file: string; readonly line: number }
  | { readonly file: string; readonly function: string };

/** One named test that reached requested source, carrying its nearest observation. */
export interface CoveringTest extends ExecutionTest {
  /** Shortest observed call-stack depth to the requested source region. */
  readonly distance: number;
}

/**
 * A run of adjacent lines every named test agrees on, and the tests themselves.
 *
 * The answer to *what does the suite claim about this file* has to be per range
 * rather than per line, because a file of four hundred lines and one boundary is
 * two answers and not four hundred. Adjacent ranges whose test lists are
 * identical are folded into one, so a range boundary is a place where the claim
 * on the code actually changes — including the change from several tests to
 * none, which is how an unclaimed region is seen at all.
 */
export interface SourceTestRange {
  readonly startLine: number;
  readonly endLine: number;
  /** Named tests shared by every line in this inclusive range. */
  readonly tests: readonly CoveringTest[];
}

/** Find named tests that reached a source line or function, nearest first. */
export function coveringTests(
  index: ExecutionIndex,
  target: SourceTestTarget,
): readonly CoveringTest[] {
  const module = index.modules.find((candidate) => candidate.file === target.file);
  if (module === undefined) return [];

  const blocks = 'line' in target
    ? innermostAt(module.blocks, target.line)
    : module.blocks.filter((block) =>
      block.source && block.kind === 'function' && block.name === target.function,
    );
  return testsForBlocks(index, blocks);
}

/** Find named tests for every indexed source line, grouped into equal adjacent ranges. */
export function coveringTestsInFile(
  index: ExecutionIndex,
  file: string,
): readonly SourceTestRange[] {
  const module = index.modules.find((candidate) => candidate.file === file);
  if (module === undefined) return [];

  const boundaries = new Set<number>();
  for (const block of module.blocks) {
    if (!block.source) continue;
    boundaries.add(block.startLine);
    boundaries.add(block.endLine + 1);
  }

  const lines = [...boundaries].sort((left, right) => left - right);
  const ranges: SourceTestRange[] = [];
  for (let at = 0; at < lines.length - 1; at += 1) {
    const startLine = lines[at]!;
    const endLine = lines[at + 1]! - 1;
    const blocks = innermostAt(module.blocks, startLine);
    if (blocks.length === 0) continue;
    const tests = testsForBlocks(index, blocks);
    const previous = ranges.at(-1);
    if (previous !== undefined && previous.endLine + 1 === startLine && sameTests(previous.tests, tests)) {
      ranges[ranges.length - 1] = { ...previous, endLine };
    } else {
      ranges.push({ startLine, endLine, tests });
    }
  }
  return ranges;
}

function testsForBlocks(
  index: ExecutionIndex,
  blocks: readonly ExecutionBlock[],
): readonly CoveringTest[] {
  const distance = new Map<number, number>();
  for (const block of blocks) {
    for (const crossing of block.crossings) {
      if (!Number.isInteger(crossing.distance) || crossing.distance < 0) throw invalidDistance();
      if (index.tests[crossing.test] === undefined) throw invalidTest(crossing.test);
      const before = distance.get(crossing.test);
      if (before === undefined || crossing.distance < before) {
        distance.set(crossing.test, crossing.distance);
      }
    }
  }

  return [...distance]
    .map(([test, observed]) => ({ ...index.tests[test]!, distance: observed }))
    .sort((left, right) =>
      left.distance - right.distance ||
      codeUnitOrder(left.file, right.file) ||
      codeUnitOrder(left.name, right.name) ||
      codeUnitOrder(left.id, right.id),
    );
}

function sameTests(left: readonly CoveringTest[], right: readonly CoveringTest[]): boolean {
  return left.length === right.length && left.every((test, at) =>
    test.id === right[at]!.id && test.distance === right[at]!.distance,
  );
}

function innermostAt(
  blocks: readonly ExecutionBlock[],
  line: number,
): readonly ExecutionBlock[] {
  if (!Number.isInteger(line) || line < 1) return [];
  const matching = blocks.filter((block) =>
    block.source && block.startLine <= line && line <= block.endLine,
  );
  return matching.filter((block) =>
    !matching.some((other) =>
      other !== block &&
      contains(block, other) &&
      (block.startLine !== other.startLine || block.endLine !== other.endLine),
    ),
  );
}

function contains(outer: ExecutionBlock, inner: ExecutionBlock): boolean {
  return outer.startLine <= inner.startLine && outer.endLine >= inner.endLine;
}

function invalidDistance(): Error {
  return new Error('invalid execution index: distance must be a non-negative integer');
}

function invalidTest(test: number): Error {
  return new Error(`invalid execution index: test ${test} does not exist`);
}

function codeUnitOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * One changed region, and what the recorded run has on it.
 *
 * `tests` and `passengers` are the same list split by the one distinction a
 * review turns on: a case that *called into* the region was exercising it, and a
 * case that was in it only because the module was evaluating was merely present
 * while it ran. Merging them would make every module-scope constant look as
 * watched as the function beneath it.
 *
 * An empty `tests` is the finding. The region changed and no case entered it by
 * a route it chose, which is the sentence a reviewer can act on — provided the
 * index is current, which this type cannot know and its reader has to say.
 */
export interface CoveringRegion {
  readonly kind: string;
  readonly name: string;
  readonly startLine: number;
  readonly endLine: number;
  /** Cases that called into the region, nearest first. */
  readonly tests: readonly CoveringTest[];
  /** Cases that were inside it only while its module was evaluating. */
  readonly passengers: readonly CoveringTest[];
}

/**
 * What one changed file's rows say, including the two ways there are none.
 *
 * A file the run never loaded and a file every region of which nobody entered
 * read identically from a list of names, and they are opposite facts: the first
 * is the index being silent, the second is the index speaking. So `recorded`
 * carries which one it is rather than leaving a reader to infer it from an empty
 * array.
 *
 * `cases` closes the third shape, which is the one a review hits constantly: a
 * changed **test file** has no module row at all, because the run instruments
 * what the tests import rather than the tests themselves. The index still knows
 * every case declared in it, and those cases are the honest answer to *what did
 * you just change* — so they are named here instead of the file being reported
 * as unmeasured.
 */
export interface CoveringChange {
  readonly file: string;
  /** Whether the index holds a module row for this file at all. */
  readonly recorded: boolean;
  readonly regions: readonly CoveringRegion[];
  /** Named cases this file declares, when it is a test file the index knows. */
  readonly cases: readonly ExecutionTest[];
}

export interface CoveringChangeOptions {
  /**
   * The file graph, carrying the taints' shadows (`relationsOfFiles(records, { shadows })`).
   *
   * A case whose file mocked the changed module, or reaches it only through a
   * mock, is neither a test nor a passenger there: it ran against the mock, and
   * nothing in the real module's text reaches it. Without the graph every
   * crossing stands, which is the record as written.
   */
  readonly relations?: Relations;
}

/**
 * Join a diff to the cases that went where it changed.
 *
 * The caller supplies the changed lines rather than a diff, because
 * {@link changedLines} is already the one parse of it that the file-grain
 * selector uses — two parses of one diff disagree at the edges a review is
 * least able to check, and a renamed or binary path is exactly such an edge.
 *
 * Files come back in the order the diff named them and every changed file comes
 * back, silent ones included. A reader that filtered the silent ones out would
 * print a confident report about the half of the change it happened to have
 * measured.
 */
export function coveringChange(
  index: ExecutionIndex,
  changed: ReadonlyMap<string, readonly { readonly start: number; readonly end: number }[]>,
  options: CoveringChangeOptions = {},
): readonly CoveringChange[] {
  const shadowed = shadowedFor(options.relations);
  const modules = new Map(index.modules.map((module) => [module.file, module]));
  const declared = new Map<string, ExecutionTest[]>();
  for (const test of index.tests) {
    const already = declared.get(test.file);
    if (already === undefined) declared.set(test.file, [test]);
    else already.push(test);
  }

  const answers: CoveringChange[] = [];
  for (const [file, ranges] of changed) {
    const module = modules.get(file);
    const cases = declared.get(file) ?? [];
    if (module === undefined) {
      answers.push({ file, recorded: false, regions: [], cases });
      continue;
    }

    const owned = ownedIn(index, module, shadowed);
    const regions = module.blocks
      .filter((block) =>
        block.source && ranges.some((range) => block.startLine <= range.end && range.start <= block.endLine),
      )
      .map((block) => ({
        kind: block.kind,
        name: block.name,
        startLine: block.startLine,
        endLine: block.endLine,
        tests: testsForBlocks(index, [{ ...block, crossings: block.crossings.filter((crossing) => owned(crossing) && crossing.loaded !== true) }]),
        passengers: testsForBlocks(index, [{ ...block, crossings: block.crossings.filter((crossing) => owned(crossing) && crossing.loaded === true) }]),
      }));

    answers.push({ file, recorded: true, regions, cases });
  }
  return answers;
}

/**
 * Whether a crossing in this module belongs to its case.
 *
 * A case whose file mocked the module, or reaches it only through a mock, holds
 * none of its crossings there, whatever they were. See `shadowed.ts`.
 */
function ownedIn(
  index: ExecutionIndex,
  module: ExecutionModule,
  shadowed: ShadowedFor | undefined,
): (crossing: ExecutionCrossing) => boolean {
  if (shadowed === undefined) return () => true;
  return (crossing) => {
    const file = index.tests[crossing.test]?.file;
    return file === undefined || !shadowed(file).has(module.file);
  };
}
