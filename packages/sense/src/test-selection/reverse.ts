import { affectedBy, type Relations } from '@variance-authority/core/relate';
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
  /**
   * The region ran while its module evaluated, in at least one recorded file.
   *
   * Which cases that was is not in `crossings`, and is not recorded at all. A
   * module evaluates once per realm, for whichever case imported it first, so a
   * set of cases here names an import order rather than a test; the file graph
   * answers the question it was standing in for — every case whose file
   * imports the module — and reads a mock the way the rest of selection does.
   * Absent on a region that never ran during load, and on an index whose
   * producer writes load time per crossing instead
   * ({@link ExecutionCrossing.loaded}).
   */
  readonly loaded?: true;
  /** Cases that called into the region. */
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
  /**
   * Named because its file imports a module whose region ran while it
   * evaluated, not because the case called into the region.
   */
  readonly loaded?: true;
}

/** What a reading of the record may consult besides the record itself. */
export interface CoveringOptions {
  /**
   * The file graph. A region that ran only while its module evaluated names
   * the cases whose files import the module through it ({@link
   * ExecutionBlock.loaded}); without it those cases are not named, and
   * {@link ranWhileLoading} says the list is short.
   */
  readonly relations?: Relations;
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
  /** The range ran while its module evaluated; see {@link ExecutionBlock.loaded}. */
  readonly loaded?: true;
}

/** Find named tests that reached a source line or function, nearest first. */
export function coveringTests(
  index: ExecutionIndex,
  target: SourceTestTarget,
  options: CoveringOptions = {},
): readonly CoveringTest[] {
  const module = index.modules.find((candidate) => candidate.file === target.file);
  if (module === undefined) return [];
  const blocks = blocksAt(module, target);
  return withLoaders(testsForBlocks(index, blocks), blocks, loadersOf(index, module.file, options.relations));
}

/**
 * Whether the region a target names ran while its module evaluated.
 *
 * The cases that loaded it are named only through the file graph, so a reader
 * that asked {@link coveringTests} without one holds a list that may be short,
 * and this is how it finds out. An empty list and a region that only ran
 * during load are opposite answers to *did anything go here*.
 */
export function ranWhileLoading(index: ExecutionIndex, target: SourceTestTarget): boolean {
  const module = index.modules.find((candidate) => candidate.file === target.file);
  return module !== undefined && blocksAt(module, target).some((block) => block.loaded === true);
}

function blocksAt(module: ExecutionModule, target: SourceTestTarget): readonly ExecutionBlock[] {
  return 'line' in target
    ? innermostAt(module.blocks, target.line)
    : module.blocks.filter((block) =>
      block.source && block.kind === 'function' && block.name === target.function,
    );
}

/** Find named tests for every indexed source line, grouped into equal adjacent ranges. */
export function coveringTestsInFile(
  index: ExecutionIndex,
  file: string,
  options: CoveringOptions = {},
): readonly SourceTestRange[] {
  const module = index.modules.find((candidate) => candidate.file === file);
  if (module === undefined) return [];
  const loaders = loadersOf(index, file, options.relations);

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
    const tests = withLoaders(testsForBlocks(index, blocks), blocks, loaders);
    const loaded = blocks.some((block) => block.loaded === true);
    const previous = ranges.at(-1);
    if (
      previous !== undefined &&
      previous.endLine + 1 === startLine &&
      (previous.loaded === true) === loaded &&
      sameTests(previous.tests, tests)
    ) {
      ranges[ranges.length - 1] = { ...previous, endLine };
    } else {
      ranges.push({ startLine, endLine, tests, ...(loaded ? { loaded: true as const } : {}) });
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

  return sortTests([...distance].map(([test, observed]) => ({ ...index.tests[test]!, distance: observed })));
}

function sameTests(left: readonly CoveringTest[], right: readonly CoveringTest[]): boolean {
  return left.length === right.length && left.every((test, at) =>
    test.id === right[at]!.id && test.distance === right[at]!.distance && test.loaded === right[at]!.loaded,
  );
}

/**
 * The cases whose files import this module, by the file graph.
 *
 * `affectedBy` is the owner: it walks the edges the scan read and leaves out a
 * file whose mocks cut every trail, which is the reading the
 * file-grain selector gives the same module. Absent without a graph, and when
 * the graph does not hold the module, because then it cannot say who imports
 * it and an empty list would say nobody does. Absent too when the graph names
 * none of the recorded cases: the flag is only ever set inside a case's run, so
 * somebody loaded the module, and a graph that finds nobody did not see how —
 * a page-side module a browser spec reached through the page, not an import.
 */
function loadersOf(
  index: ExecutionIndex,
  file: string,
  relations: Relations | undefined,
): readonly CoveringTest[] | undefined {
  if (relations === undefined) return undefined;
  const affected = affectedBy(relations, [file]);
  if (affected.missing.length > 0) return undefined;
  const files = new Set(affected.files);
  const loaders = index.tests.filter((test) => files.has(test.file));
  if (loaders.length === 0) return undefined;
  return sortTests(loaders.map((test) => ({ ...test, distance: 0, loaded: true as const })));
}

/** Callers first, then the loaders of any region among `blocks` that ran during load. */
function withLoaders(
  tests: readonly CoveringTest[],
  blocks: readonly ExecutionBlock[],
  loaders: readonly CoveringTest[] | undefined,
): readonly CoveringTest[] {
  if (loaders === undefined || !blocks.some((block) => block.loaded === true)) return tests;
  const called = new Set(tests.map((test) => test.id));
  return [...tests, ...loaders.filter((test) => !called.has(test.id))];
}

function sortTests(tests: CoveringTest[]): readonly CoveringTest[] {
  return tests.sort((left, right) =>
    left.distance - right.distance ||
    codeUnitOrder(left.file, right.file) ||
    codeUnitOrder(left.name, right.name) ||
    codeUnitOrder(left.id, right.id),
  );
}

export function innermostAt(
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
  /**
   * Cases that were inside it only while its module was evaluating.
   *
   * Absent when the region ran during load and no file graph was given to name
   * who loaded it, or the graph named none of the recorded cases
   * ({@link ExecutionBlock.loaded}): some cases were carried in, and which ones
   * is a question this reading could not answer.
   */
  readonly passengers?: readonly CoveringTest[];
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
    let loaders: readonly CoveringTest[] | undefined;
    const regions = module.blocks
      .filter((block) =>
        block.source && ranges.some((range) => block.startLine <= range.end && range.start <= block.endLine),
      )
      .map((block): CoveringRegion => {
        const tests = testsForBlocks(index, [{ ...block, crossings: block.crossings.filter((crossing) => owned(crossing) && crossing.loaded !== true) }]);
        const carried = testsForBlocks(index, [{ ...block, crossings: block.crossings.filter((crossing) => owned(crossing) && crossing.loaded === true) }]);
        const region = { kind: block.kind, name: block.name, startLine: block.startLine, endLine: block.endLine, tests };
        if (block.loaded !== true) return { ...region, passengers: carried };
        loaders ??= loadersOf(index, file, options.relations);
        if (loaders === undefined) return region;
        const known = new Set([...tests, ...carried].map((test) => test.id));
        return { ...region, passengers: [...carried, ...loaders.filter((test) => !known.has(test.id))] };
      });

    answers.push({ file, recorded: true, regions, cases });
  }
  return answers;
}

/**
 * Whether a crossing in this module belongs to its case.
 *
 * Every crossing a case made is its own: its mocks were installed before it
 * ran. Only a crossing made while the module evaluated can be a mock's work —
 * a runner evaluating the real module to shape it — and a case whose file
 * mocked the module, or reaches it only through a mock, does not hold those.
 * See `shadowed.ts`.
 */
export function ownedIn(
  index: ExecutionIndex,
  module: ExecutionModule,
  shadowed: ShadowedFor | undefined,
): (crossing: ExecutionCrossing) => boolean {
  if (shadowed === undefined) return () => true;
  return (crossing) => {
    if (crossing.loaded !== true) return true;
    const file = index.tests[crossing.test]?.file;
    return file === undefined || !shadowed(file).has(module.file);
  };
}
