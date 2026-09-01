import { describe, expect, it } from 'vitest';
import { decodeTestCoverage, encodeTestCoverage } from './format.js';
import type { TestCoverage } from './index.js';

describe('the persisted coverage format', () => {
  it('round-trips without storing repeated test paths in every block', async () => {
    const coverage = representativeCoverage();
    const expandedJson = Buffer.byteLength(JSON.stringify(coverage));
    const encoded = await encodeTestCoverage(coverage);

    expect(await decodeTestCoverage(encoded)).toEqual(coverage);
    expect(encoded.byteLength).toBeLessThan(expandedJson / 8);
  });

  it('canonicalizes sets and code-unit orders before encoding', () => {
    const coverage = representativeCoverage();
    const shuffled: TestCoverage = {
      ...coverage,
      tests: [...coverage.tests].reverse().map((test) => ({
        ...test,
        preconditions: [...test.preconditions].reverse(),
      })),
      modules: [...coverage.modules].reverse().map((module) => ({
        ...module,
        blocks: [...module.blocks].reverse().map((block) => ({
          ...block,
          testFiles: [...block.testFiles].reverse(),
        })),
      })),
    };

    expect(encodeTestCoverage(shuffled)).toEqual(encodeTestCoverage(coverage));
  });

  it('represents instrumentation refusal instead of an empty module observation', () => {
    const coverage = representativeCoverage();
    const unavailable: TestCoverage = {
      ...coverage,
      modules: [...coverage.modules, {
        file: 'src/unavailable.ts',
        sourceDigest: 'source:unavailable',
        instrumented: false,
        blocks: [],
      }],
    };

    expect(decodeTestCoverage(encodeTestCoverage(unavailable)).modules.at(-1)).toEqual({
      file: 'src/unavailable.ts',
      sourceDigest: 'source:unavailable',
      instrumented: false,
      blocks: [],
    });
  });

  it('carries the commit a snapshot was recorded at, and its absence', () => {
    // The whole of an index's position. A file that has one can be diffed
    // against; a file that has none says so rather than naming a commit a
    // reader would then diff against and be wrong about.
    const positioned: TestCoverage = {
      ...representativeCoverage(),
      commit: '9b6a1f2e4c8d0a35b7e9f1c3d5a7b9e1f3c5a7b9',
    };

    expect(decodeTestCoverage(encodeTestCoverage(positioned)).commit).toBe(
      '9b6a1f2e4c8d0a35b7e9f1c3d5a7b9e1f3c5a7b9',
    );
    expect(decodeTestCoverage(encodeTestCoverage(representativeCoverage()))).not.toHaveProperty(
      'commit',
    );
  });

  it('rejects invalid state columns before they can answer a query', () => {
    const encoded = encodeTestCoverage(representativeCoverage());
    const headerLength = encoded.readUInt32LE(0);
    const header = JSON.parse(encoded.toString('utf8', 4, 4 + headerLength).replace(/\0+$/, '')) as {
      sections: Array<{ name: string; offset: number }>;
    };
    const section = header.sections.find((candidate) => candidate.name === 'modules.instrumented')!;
    const corrupt = Buffer.from(encoded);
    corrupt[4 + headerLength + section.offset] = 2;

    expect(() => decodeTestCoverage(corrupt)).toThrow(/not a variance-authority test coverage artifact/);
  });

  it('rejects a section that aliases bytes outside the artifact payload', () => {
    const encoded = encodeTestCoverage(representativeCoverage());
    const headerLength = encoded.readUInt32LE(0);
    const header = JSON.parse(encoded.toString('utf8', 4, 4 + headerLength).replace(/\0+$/, '')) as {
      sections: Array<{ name: string; offset: number }>;
    };
    header.sections[0]!.offset = -8;
    const corrupt = Buffer.from(encoded);
    const changed = Buffer.from(JSON.stringify(header), 'utf8');
    corrupt.fill(0, 4, 4 + headerLength);
    changed.copy(corrupt, 4);

    expect(() => decodeTestCoverage(corrupt)).toThrow(/not a variance-authority test coverage artifact/);
  });

  it('refuses a snapshot from the previous block universe', () => {
    const encoded = encodeTestCoverage(representativeCoverage());
    const headerLength = encoded.readUInt32LE(0);
    const header = JSON.parse(encoded.toString('utf8', 4, 4 + headerLength).replace(/\0+$/, '')) as {
      version: number;
    };
    const prior = Buffer.from(encoded);
    const oldHeader = Buffer.from(JSON.stringify({ ...header, version: 1 }), 'utf8');
    prior.fill(0, 4, 4 + headerLength);
    oldHeader.copy(prior, 4);

    expect(() => decodeTestCoverage(prior)).toThrow(/unsupported test coverage version: 1/);
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
  ).sort();
  return {
    version: 3,
    instrumentation: 'fixture-instrumentation',
    tests: testFiles.map((file) => ({
      file,
      complete: true,
      preconditions: [
        { name: file, digest: `source:${file}` },
        { name: 'vitest.config.ts', digest: 'source:config' },
      ],
    })),
    modules: Array.from({ length: 50 }, (_, module) => ({
      file: `packages/application/src/feature-${module}/implementation.ts`,
      sourceDigest: `source:module:${module}`,
      instrumented: true,
      blocks: Array.from({ length: 20 }, (_, ordinal) => ({
        ordinal,
        kind: ordinal === 0 ? 'module' : 'branch',
        ...(ordinal === 0 ? {} : { owner: 0 }),
        digest: `block:${module}:${ordinal}`,
        name: `feature${module}/decide`,
        path: ordinal === 0 ? 'module' : `if#${ordinal}/then`,
        startLine: ordinal * 3 + 1,
        endLine: ordinal * 3 + 3,
        source: true,
        testFiles: Array.from(
          { length: 20 },
          (_, offset) => testFiles[(module * 7 + ordinal * 3 + offset) % testFiles.length]!,
        ).sort(),
      })),
    })).sort((left, right) => left.file < right.file ? -1 : left.file > right.file ? 1 : 0),
  };
}
