import { readFile, rm, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { instrumentationId } from '../instrument/index.js';
import { decodeTestCoverage } from './format.js';
import { mergeCoverage, withTestSelection } from './vitest.js';
import type { CoverageBlock, TestCoverage } from './index.js';

describe('coverage generations', () => {
  it('records instrumentation refusal instead of an empty module observation', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'variance-instrumentation-refusal-'));
    const coverageFile = resolve(root, 'coverage.bin');
    try {
      const configured = withTestSelection({}, { root, coverageFile, include: () => true });
      const plugin = (configured.plugins as unknown as Array<{
        transform(code: string, id: string): unknown;
      }>)[0]!;
      const reporter = (configured.test!.reporters as unknown as Array<{
        onFinished(files: readonly []): Promise<void>;
      }>)[1]!;

      expect(plugin.transform('const =', resolve(root, 'broken.ts'))).toBeNull();
      await reporter.onFinished([]);

      expect(decodeTestCoverage(await readFile(coverageFile)).modules).toEqual([{
        file: 'broken.ts',
        sourceDigest: expect.stringMatching(/^v1:/),
        instrumented: false,
        blocks: [],
      }]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('says so when a run that had test files instrumented nothing', async () => {
    // The failure this warning exists for is invisible: the run is green, the
    // snapshot is written, and every selection made from it afterwards is empty.
    const root = await mkdtemp(resolve(tmpdir(), 'variance-instrumentation-empty-'));
    const coverageFile = resolve(root, 'coverage.bin');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const testFile = resolve(root, 'case.test.ts');
      await writeFile(testFile, 'it("x", () => {});\n', 'utf8');
      const configured = withTestSelection({}, { root, coverageFile, include: () => false });
      const reporter = (configured.test!.reporters as unknown as Array<{
        onFinished(files: readonly unknown[]): Promise<void>;
      }>)[1]!;

      await reporter.onFinished([{ filepath: testFile, tasks: [] }]);

      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0]?.[0]).toMatch(/instrumented 0 modules across 1 test file/);
      expect(warn.mock.calls[0]?.[0]).toMatch(/projects/);
    } finally {
      warn.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('says nothing when a run collected no test files at all', async () => {
    // Not the same state. A run that collected nothing has already said so in
    // the runner's own output, and repeating it here would train a reader to
    // scroll past the sentence that matters.
    const root = await mkdtemp(resolve(tmpdir(), 'variance-instrumentation-nofiles-'));
    const coverageFile = resolve(root, 'coverage.bin');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const configured = withTestSelection({}, { root, coverageFile, include: () => false });
      const reporter = (configured.test!.reporters as unknown as Array<{
        onFinished(files: readonly []): Promise<void>;
      }>)[1]!;

      await reporter.onFinished([]);

      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('cuts and lands under the entries recipe when asked for it', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'variance-instrumentation-entries-'));
    const coverageFile = resolve(root, 'coverage.bin');
    try {
      const configured = withTestSelection({}, { root, coverageFile, include: () => true, mode: 'entries' });
      const plugin = (configured.plugins as unknown as Array<{
        transform(code: string, id: string): { code: string } | null;
      }>)[0]!;
      const reporter = (configured.test!.reporters as unknown as Array<{
        onFinished(files: readonly []): Promise<void>;
      }>)[1]!;

      const placed = plugin.transform('export function f(x) { if (x) { return 1; } return 2; }', resolve(root, 'f.ts'));
      await reporter.onFinished([]);

      // One probe for the module, one for the function, none for the branch.
      expect(placed!.code.match(/__va\(\d+\)/g)).toEqual(['__va(0)', '__va(1)']);
      const coverage = decodeTestCoverage(await readFile(coverageFile));
      expect(coverage.instrumentation).toBe(instrumentationId('entries'));
      expect(coverage.modules[0]?.blocks.map((block) => block.kind)).toEqual(['module', 'function']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('lets a completed changed test replace every old crossing', () => {
    const previous = coverage(true, 'test:old', module('source:old', ['case.test.ts']));
    const current = coverage(true, 'test:new');

    const merged = mergeCoverage(previous, current);

    expect(merged.tests).toEqual(current.tests);
    expect(merged.modules[0]?.blocks.flatMap((block) => block.testFiles)).toEqual([]);
  });

  it('keeps old crossings when a focused or failed run is incomplete in the same generation', () => {
    const previous = coverage(true, 'test:same', module('source:old', ['case.test.ts']));
    const current = coverage(false, 'test:same');

    const merged = mergeCoverage(previous, current);

    expect(merged.tests).toEqual(current.tests);
    expect(merged.modules[0]?.blocks.flatMap((block) => block.testFiles)).toContain('case.test.ts');
  });

  it('retires crossings inherited from changed test, mock, hook, or setup preconditions', () => {
    const previous = coverage(true, 'test:old', module('source:old', ['case.test.ts']));
    const current = coverage(false, 'test:new');

    const merged = mergeCoverage(previous, current);

    expect(merged.tests).toEqual(current.tests);
    expect(merged.tests[0]?.complete).toBe(false);
    expect(merged.modules[0]?.blocks.flatMap((block) => block.testFiles)).toEqual([]);
  });

  it('carries an outcome through an edit to the region that governs it', () => {
    // The condition belongs to the region around the arms, so editing it moves
    // that region's digest and not the arm's. The arm's crossing still carries:
    // a diff of the condition is charged to the region that holds it, and the
    // test that reached the arm reached that region too, so it is selected from
    // there. Retiring the arm's crossing would discard evidence and select
    // nobody extra.
    const previous = coverage(
      true,
      'test:old',
      module('source:old', ['case.test.ts'], { entry: 'entry:old', outcome: 'outcome:same' }),
    );
    const current = coverage(
      false,
      'test:old',
      module('source:new', [], { entry: 'entry:new', outcome: 'outcome:same' }),
    );

    const merged = mergeCoverage(previous, current);
    const blocks = merged.modules[0]!.blocks;

    expect(blocks.find((block) => block.path === 'entry')?.testFiles).toEqual(['case.test.ts']);
    expect(blocks.find((block) => block.path === 'if#0/then')?.testFiles)
      .toEqual(['case.test.ts']);
  });

  it('drops a crossing when the module no longer has the region it names', () => {
    // Identity is the address — the declaration name path and the structural
    // path inside it — so a renamed function is not the function that was
    // recorded, and nothing carries onto the one that took its place.
    const previous = coverage(true, 'test:old', module('source:old', ['case.test.ts']));
    const current = coverage(false, 'test:old', module('source:new', [], {}, 'chose'));

    const merged = mergeCoverage(previous, current);
    const blocks = merged.modules[0]!.blocks;

    expect(blocks.find((block) => block.name === 'chose')?.testFiles).toEqual([]);
    expect(blocks.find((block) => block.path === 'module')?.testFiles).toEqual(['case.test.ts']);
  });
});

function coverage(
  complete: boolean,
  testDigest: string,
  sourceModule?: TestCoverage['modules'][number],
): TestCoverage {
  return {
    version: 3,
    instrumentation: 'fixture-instrumentation',
    tests: [{
      file: 'case.test.ts',
      complete,
      preconditions: [{ name: 'case.test.ts', digest: testDigest }],
    }],
    modules: sourceModule === undefined ? [] : [sourceModule],
  };
}

function module(
  sourceDigest: string,
  testFiles: readonly string[],
  digests: Partial<Record<'entry' | 'outcome' | 'taken' | 'otherwise', string>> = {},
  name = 'decide',
): TestCoverage['modules'][number] {
  const blocks: CoverageBlock[] = [
    block(0, 'module', 'module', 'module:same', testFiles, undefined, name),
    block(1, 'function', 'entry', digests.entry ?? 'entry:same', testFiles, 0, name),
    block(2, 'branch', 'if#0/then', digests.outcome ?? digests.taken ?? 'then:same', testFiles, 1, name),
    block(3, 'branch', 'if#0/else', digests.outcome ?? digests.otherwise ?? 'else:same', testFiles, 1, name),
  ];
  return { file: 'source.ts', sourceDigest, instrumented: true, blocks };
}

function block(
  ordinal: number,
  kind: string,
  path: string,
  digest: string,
  testFiles: readonly string[],
  owner: number | undefined,
  name: string,
): CoverageBlock {
  return {
    ordinal,
    kind,
    ...(owner === undefined ? {} : { owner }),
    digest,
    name: kind === 'module' ? '' : name,
    path,
    startLine: ordinal + 1,
    endLine: ordinal + 1,
    source: true,
    testFiles,
  };
}
