import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { FileRecord } from '@variance-authority/core/relate';
import { MODULE_EXTENSIONS } from '../read.js';
import type {
  CodeExtent,
  DeviationOptions,
  TestDeviation,
  VariationDeviation,
} from './index.js';
import type { TestCoverageView } from './format-view.js';

interface SourceFile {
  readonly code: readonly boolean[];
  readonly loc: number;
}

interface Baseline {
  readonly loc: number;
  readonly files: Set<string>;
  readonly unknown: readonly string[];
}

/** The calculation over an already-open compact coverage snapshot. */
export async function deviationFromView(
  view: TestCoverageView,
  options: DeviationOptions,
): Promise<VariationDeviation> {
  const root = resolve(options.root);
  const sources = new Map<string, Promise<SourceFile>>();
  const source = (file: string): Promise<SourceFile> => {
    const found = sources.get(file);
    if (found !== undefined) return found;
    const reading = readFile(resolve(root, file), 'utf8').then(sourceFile);
    sources.set(file, reading);
    return reading;
  };

  const tests = Array.from(view.testPath.all(), (path) => view.string(path));
  const sliceLoc = new Uint32Array(tests.length);
  const sliceFiles = new Map(tests.map((test) => [test, new Set<string>()]));
  let coverageLoc = 0;
  const suiteCoverageFiles = new Set<string>();

  for (let module = 0; module < view.modulePath.length; module += 1) {
    const file = view.string(view.modulePath.at(module));
    const lines = (await source(file)).code;
    const best = new Uint32Array(lines.length).fill(0xffffffff);
    const owners: Array<Set<number> | undefined> = Array.from({ length: lines.length });

    for (let block = view.moduleBlocks.at(module); block < view.moduleBlocks.at(module + 1); block += 1) {
      if (view.blockSource.at(block) !== 1) continue;
      const start = view.blockStart.at(block);
      const end = view.blockEnd.at(block);
      const span = end - start;
      const entered = new Set(view.crossings.members(view.blockSet.at(block)));
      for (let line = start; line <= end && line < lines.length; line += 1) {
        if (lines[line] !== true || span > best[line]!) continue;
        if (span < best[line]!) {
          best[line] = span;
          owners[line] = entered;
        } else {
          const owner = owners[line];
          if (owner === undefined) owners[line] = entered;
          else if (!sameTests(owner, entered)) owners[line] = new Set([...owner, ...entered]);
        }
      }
    }

    for (let line = 1; line < owners.length; line += 1) {
      const entered = owners[line];
      if (entered === undefined || entered.size === 0) continue;
      coverageLoc += 1;
      suiteCoverageFiles.add(file);
      for (const test of entered) {
        const testFile = tests[test];
        if (testFile === undefined) continue;
        sliceLoc[test] = sliceLoc[test]! + 1;
        sliceFiles.get(testFile)!.add(file);
      }
    }
  }

  const records = new Map(options.records.map((record) => [record.file, record]));
  const baselines = await Promise.all(tests.map((test) => baselineOf(test, records, source)));
  const suiteBaselineFiles = new Set<string>();
  const rows: TestDeviation[] = [];

  for (let index = 0; index < tests.length; index += 1) {
    const testFile = tests[index]!;
    const baseline = baselines[index]!;
    const slice: CodeExtent = { files: sliceFiles.get(testFile)!.size, loc: sliceLoc[index]! };
    if (baseline.unknown.length > 0) {
      rows.push({ testFile, slice, unknown: baseline.unknown });
      continue;
    }
    for (const file of baseline.files) suiteBaselineFiles.add(file);
    const extent = { files: baseline.files.size, loc: baseline.loc };
    const sensitivity = extent.loc === 0 ? undefined : slice.loc / extent.loc;
    rows.push({
      testFile,
      baseline: extent,
      slice,
      ...(sensitivity === undefined ? {} : { sensitivity, deviation: 1 - sensitivity }),
    });
  }

  const complete = rows.every((row) => row.baseline !== undefined);
  const baselineLoc = complete
    ? (await Promise.all([...suiteBaselineFiles].map(async (file) => (await source(file)).loc)))
      .reduce((sum, loc) => sum + loc, 0)
    : undefined;
  const baseline = baselineLoc === undefined ? undefined : { files: suiteBaselineFiles.size, loc: baselineLoc };
  const coverage = { files: suiteCoverageFiles.size, loc: coverageLoc };
  const sensitivity = complete && rows.length > 0 && rows.every((row) => row.sensitivity !== undefined)
    ? rows.reduce((sum, row) => sum + row.sensitivity!, 0) / rows.length
    : undefined;
  const coverageRatio = baseline !== undefined && baseline.loc > 0
    ? coverage.loc / baseline.loc
    : undefined;

  return {
    ...(baseline === undefined ? {} : { baseline }),
    coverage,
    ...(coverageRatio === undefined ? {} : { coverageRatio }),
    ...(sensitivity === undefined ? {} : { sensitivity }),
    tests: rows,
  };
}

async function baselineOf(
  testFile: string,
  records: ReadonlyMap<string, FileRecord>,
  source: (file: string) => Promise<SourceFile>,
): Promise<Baseline> {
  if (!records.has(testFile)) {
    return { loc: 0, files: new Set(), unknown: [`${testFile}: missing from Sense`] };
  }

  const files = new Set<string>();
  let loc = 0;
  const unknown: string[] = [];
  const reached = new Set<string>();
  const queue = [testFile];
  for (let head = 0; head < queue.length; head += 1) {
    const file = queue[head]!;
    if (reached.has(file)) continue;
    reached.add(file);
    const record = records.get(file);
    if (record === undefined) {
      unknown.push(`${file}: missing from Sense`);
      continue;
    }
    if (record.unknown !== undefined) unknown.push(`${file}: ${record.unknown}`);
    for (const edge of record.edges ?? []) queue.push(edge.to);

    if (file === testFile || !isModule(file)) continue;
    files.add(file);
    loc += (await source(file)).loc;
  }
  return { loc, files, unknown: unknown.sort(codeUnitOrder) };
}

function sourceFile(contents: string): SourceFile {
  const code = [false, ...contents.split('\n').map((line) => line.trim().length > 0)];
  return { code, loc: code.reduce((sum, line) => sum + (line ? 1 : 0), 0) };
}

function isModule(file: string): boolean {
  return MODULE_EXTENSIONS.some((extension) => file.endsWith(extension));
}

function sameTests(left: ReadonlySet<number>, right: ReadonlySet<number>): boolean {
  if (left.size !== right.size) return false;
  for (const test of left) if (!right.has(test)) return false;
  return true;
}

function codeUnitOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
