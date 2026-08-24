import { describe, expect, it } from 'vitest';
import { decodeTestCoverage, encodeTestCoverage } from './format.js';
import type { TestCoverage } from './index.js';

describe('the persisted coverage format', () => {
  it('round-trips without storing repeated test paths in every block', async () => {
    const coverage = representativeCoverage();
    const expandedJson = Buffer.byteLength(JSON.stringify(coverage));
    const encoded = await encodeTestCoverage(coverage);

    expect(await decodeTestCoverage(encoded)).toEqual(coverage);
    expect(encoded.byteLength).toBeLessThan(expandedJson / 10);
  });

  it('rejects JSON instead of mistaking it for a coverage artifact', async () => {
    expect(() => decodeTestCoverage(Buffer.from('{"version":1}'))).toThrow(
      /not a variance-authority test coverage artifact/,
    );
  });
});

function representativeCoverage(): TestCoverage {
  const testFiles = Array.from({ length: 200 }, (_, index) =>
    `packages/application/src/feature-${index}/feature-${index}.test.ts`,
  );
  return {
    version: 1,
    modules: Array.from({ length: 50 }, (_, module) => ({
      file: `packages/application/src/feature-${module}/implementation.ts`,
      blocks: Array.from({ length: 20 }, (_, ordinal) => ({
        ordinal,
        kind: ordinal === 0 ? 'module' : 'branch',
        name: `feature${module}/decide`,
        path: ordinal === 0 ? 'module' : `if#${ordinal}/then`,
        startLine: ordinal * 3 + 1,
        endLine: ordinal * 3 + 3,
        testFiles: Array.from(
          { length: 20 },
          (_, offset) => testFiles[(module * 7 + ordinal * 3 + offset) % testFiles.length]!,
        ),
      })),
    })),
  };
}
