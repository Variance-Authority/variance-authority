import { readFile } from 'node:fs/promises';

export interface CoverageBlock {
  readonly ordinal: number;
  readonly kind: string;
  readonly name: string;
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly testFiles: readonly string[];
}

export interface CoverageModule {
  readonly file: string;
  readonly blocks: readonly CoverageBlock[];
}

export interface TestCoverage {
  readonly version: 1;
  readonly modules: readonly CoverageModule[];
}

/** Read coverage previously written by the Vitest integration. */
export async function readTestCoverage(file: string): Promise<TestCoverage> {
  return JSON.parse(await readFile(file, 'utf8')) as TestCoverage;
}

/**
 * Return the test files whose recorded source regions intersect a unified diff.
 *
 * Selection is deliberately no finer than a test file. Vitest remains responsible
 * for collecting and executing the tests inside every returned file.
 */
export function selectTestFiles(coverage: TestCoverage, diff: string): readonly string[] {
  const changed = changedLines(diff);
  const selected = new Set<string>();

  for (const module of coverage.modules) {
    const ranges = changed.get(module.file);
    if (ranges === undefined) continue;

    const matching = module.blocks.filter((block) =>
      ranges.some((range) => intersects(block.startLine, block.endLine, range.start, range.end)),
    );
    // A module and its enclosing function necessarily overlap every change below
    // them. Prefer the innermost recorded regions or every edit would collapse to
    // every test that imported the module.
    const innermost = matching.filter(
      (block) =>
        !matching.some(
          (other) =>
            other !== block &&
            contains(block.startLine, block.endLine, other.startLine, other.endLine) &&
            (block.startLine !== other.startLine || block.endLine !== other.endLine),
        ),
    );
    const blocks = matching.length === 0 ? module.blocks : innermost;
    for (const block of blocks) {
      for (const testFile of block.testFiles) selected.add(testFile);
    }
  }

  return [...selected].sort(codeUnitOrder);
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
