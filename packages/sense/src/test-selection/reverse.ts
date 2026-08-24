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

export interface CoveringTest extends ExecutionTest {
  /** Shortest observed call-stack depth to the requested source region. */
  readonly distance: number;
}

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
