import { readFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
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

  it('does not transfer an outcome through a changed precondition owner', () => {
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

    expect(merged.modules[0]?.blocks.find((block) => block.path === 'if#0/then')?.testFiles)
      .toEqual([]);
  });

  it('keeps an unaffected sibling when only one outcome changes', () => {
    const previous = coverage(
      true,
      'test:old',
      module('source:old', ['case.test.ts'], { taken: 'then:old', otherwise: 'else:same' }),
    );
    const current = coverage(
      false,
      'test:old',
      module('source:new', [], { taken: 'then:new', otherwise: 'else:same' }),
    );

    const merged = mergeCoverage(previous, current);
    const blocks = merged.modules[0]!.blocks;

    expect(blocks.find((block) => block.path === 'if#0/then')?.testFiles).toEqual([]);
    expect(blocks.find((block) => block.path === 'if#0/else')?.testFiles)
      .toEqual(['case.test.ts']);
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
): TestCoverage['modules'][number] {
  const blocks: CoverageBlock[] = [
    block(0, 'module', 'module', 'module:same', testFiles),
    block(1, 'function', 'entry', digests.entry ?? 'entry:same', testFiles, 0),
    block(2, 'branch', 'if#0/then', digests.outcome ?? digests.taken ?? 'then:same', testFiles, 1),
    block(3, 'branch', 'if#0/else', digests.outcome ?? digests.otherwise ?? 'else:same', testFiles, 1),
  ];
  return { file: 'source.ts', sourceDigest, instrumented: true, blocks };
}

function block(
  ordinal: number,
  kind: string,
  path: string,
  digest: string,
  testFiles: readonly string[],
  owner?: number,
): CoverageBlock {
  return {
    ordinal,
    kind,
    ...(owner === undefined ? {} : { owner }),
    digest,
    name: kind === 'module' ? '' : 'decide',
    path,
    startLine: ordinal + 1,
    endLine: ordinal + 1,
    source: true,
    testFiles,
  };
}
