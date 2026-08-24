import type { TestCoverageView } from './format.js';

/** Query the binary columns without materializing the coverage graph. */
export function selectTestFilesFromView(
  coverage: TestCoverageView,
  diff: string,
): readonly string[] {
  const changed = changedLines(diff);
  const selected = new Set<number>();

  for (const [file, ranges] of changed) {
    const module = findModule(coverage, file);
    if (module === undefined) continue;
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

  return [...selected]
    .map((test) => coverage.string(coverage.testPath[test]!))
    .sort(codeUnitOrder);
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
