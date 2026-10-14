import { describe, expect, it } from 'vitest';
import { foldTestCoverage } from './merge.js';
import type { TestCoverage } from './index.js';

function shard(at: number): TestCoverage {
  const files = Array.from({ length: 32 }, (_, i) => `test/${at}/${i}.ts`).sort();
  return {
    version: 3, instrumentation: 'shared-crossings', commit: 'one-run',
    tests: files.map((file) => ({ file, complete: true, preconditions: [] })),
    modules: [{ file: 'src/shared.ts', sourceDigest: 'same-source', instrumented: true,
      blocks: Array.from({ length: 64 }, (_, ordinal) => ({
        ordinal, kind: ordinal === 0 ? 'module' : 'function',
        name: String(ordinal), path: String(ordinal), digest: String(ordinal), source: true,
        ...(ordinal === 0 ? {} : { owner: 0 }),
        testFiles: files, loadedBy: files,
      })),
    }],
  };
}

describe('folding shared crossing sets', () => {
  it('unions a repeated crossing list once, rather than once per region', () => {
    let visits = 0;
    const snapshots = Array.from({ length: 8 }, (_, at) => {
      const coverage = shard(at);
      const files = coverage.modules[0]!.blocks[0]!.testFiles;
      const iterate = files[Symbol.iterator].bind(files);
      Object.defineProperty(files, Symbol.iterator, { value: function* () {
        for (const file of iterate()) { visits += 1; yield file; }
      } });
      return { path: `shard-${at}.bin`, coverage };
    });
    const folded = foldTestCoverage(snapshots);
    const expected = snapshots.flatMap(({ coverage }) => coverage.tests.map(({ file }) => file)).sort();
    for (const block of folded.modules[0]!.blocks) {
      expect(block.testFiles).toEqual(expected);
      expect(block.loadedBy).toEqual(expected);
    }
    expect(visits).toBeLessThanOrEqual(expected.length * 2);
  });
});
