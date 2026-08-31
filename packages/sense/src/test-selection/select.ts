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

  return { whole: whole.sort(codeUnitOrder), entered: selectTestFilesFromView(coverage, diff) };
}

/** Query the binary columns without materializing the coverage graph. */
export function selectTestFilesFromView(
  coverage: TestCoverageView,
  diff: string,
): readonly string[] {
  const changed = changedLines(diff);
  const selected = new Set<number>();
  const governing: string[] = [];

  for (const [file, ranges] of changed) {
    const module = findModule(coverage, file);
    if (module === undefined) {
      governing.push(file);
      continue;
    }
    const first = coverage.moduleBlocks[module]!;
    const end = coverage.moduleBlocks[module + 1]!;
    const matching: number[] = [];
    for (let block = first; block < end; block += 1) {
      if (
        ranges.some((range) =>
          intersects(coverage.blockStart[block]!, coverage.blockEnd[block]!, range.start, range.end),
        )
      ) {
        matching.push(block);
      }
    }
    const innermost = matching.filter(
      (block) =>
        !matching.some(
          (other) =>
            other !== block &&
            contains(
              coverage.blockStart[block]!,
              coverage.blockEnd[block]!,
              coverage.blockStart[other]!,
              coverage.blockEnd[other]!,
            ) &&
            (coverage.blockStart[block] !== coverage.blockStart[other] ||
              coverage.blockEnd[block] !== coverage.blockEnd[other]),
        ),
    );
    const blocks = matching.length === 0
      ? Array.from({ length: end - first }, (_, offset) => first + offset)
      : innermost;
    for (const block of blocks) {
      for (
        let crossing = coverage.blockTests[block]!;
        crossing < coverage.blockTests[block + 1]!;
        crossing += 1
      ) {
        selected.add(coverage.crossingTest[crossing]!);
      }
    }
  }

  for (const test of testsGovernedBy(coverage, governing)) {
    selected.add(test);
  }

  return [...selected]
    .map((test) => coverage.string(coverage.testPath[test]!))
    .sort(codeUnitOrder);
}

/**
 * Tests a changed file governs, for the files no instrumented module answers
 * for.
 *
 * Coverage records where execution *entered* a module, so a file nothing enters
 * has no module row however much it decides. A test file is one: it is its own
 * recorded precondition, and nothing enters it. A declared `preconditions` entry
 * — runner configuration, a fixture, an environment file — is another, and it is
 * every test's. Read as "no module, no tests", a commit that edits a test
 * selected nothing and the new test never ran; a commit that changed the runner
 * config selected nothing and every test that config governs never ran. Both are
 * silent: the selector returns an empty list and the run is green.
 */
function testsGovernedBy(
  coverage: TestCoverageView,
  files: readonly string[],
): readonly number[] {
  if (files.length === 0) return [];
  const wanted = new Set(files);
  const governed: number[] = [];

  for (let test = 0; test < coverage.testPath.length; test += 1) {
    for (
      let input = coverage.testPreconditions[test]!;
      input < coverage.testPreconditions[test + 1]!;
      input += 1
    ) {
      if (wanted.has(coverage.string(coverage.preconditionName[input]!))) {
        governed.push(test);
        break;
      }
    }
  }

  return governed;
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

function changedLines(diff: string): ReadonlyMap<string, readonly LineRange[]> {
  const byFile = new Map<string, LineRange[]>();
  let file: string | undefined;

  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      file = diffPath(line.slice(4));
      continue;
    }
    if (file === undefined || !line.startsWith('@@ ')) continue;

    const match = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/.exec(line);
    if (match === null) continue;

    const start = Number(match[1]);
    const count = Number(match[2] ?? '1');
    const ranges = byFile.get(file) ?? [];
    ranges.push({ start, end: start + Math.max(count, 1) - 1 });
    byFile.set(file, ranges);
  }

  return byFile;
}

function diffPath(value: string): string | undefined {
  const path = value.split('\t')[0];
  if (path === undefined || path === '/dev/null') return undefined;
  return path.startsWith('b/') ? path.slice(2) : path;
}

function intersects(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number): boolean {
  return leftStart <= rightEnd && rightStart <= Math.max(leftStart, leftEnd);
}

function contains(outerStart: number, outerEnd: number, innerStart: number, innerEnd: number): boolean {
  return outerStart <= innerStart && Math.max(outerStart, outerEnd) >= Math.max(innerStart, innerEnd);
}

function codeUnitOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
