import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FileRecord } from '@variance-authority/core';
import { deviationFromView } from './deviation.js';
import { encodeTestCoverage, openTestCoverage } from './format.js';
import type { TestCoverage } from './index.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('test-file deviation', () => {
  it('compares innermost execution slices with each forward Sense closure', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'variance-deviation-'));
    roots.push(root);
    await writeFile(resolve(root, 'decide.ts'), [
      'export function decide(value: string) {',
      "  if (value === 'alpha') {",
      "    return 'A';",
      '  }',
      "  return 'B';",
      '}',
    ].join('\n'));
    await writeFile(resolve(root, 'helper.ts'), 'export const one = 1;\nexport const two = 2;\n');

    const records: readonly FileRecord[] = [
      { file: 'alpha.test.ts', edges: [{ to: 'decide.ts', kind: 'imports' }] },
      { file: 'beta.test.ts', edges: [{ to: 'decide.ts', kind: 'imports' }] },
      { file: 'type-only.test.ts', edges: [{ to: 'helper.ts', kind: 'type' }] },
      { file: 'decide.ts', edges: [{ to: 'helper.ts', kind: 'imports' }] },
      { file: 'helper.ts' },
    ];
    const coverage: TestCoverage = {
      version: 2,
      instrumentation: 'fixture-instrumentation',
      tests: observations(['alpha.test.ts', 'beta.test.ts', 'type-only.test.ts']),
      modules: [{
        file: 'decide.ts',
        sourceDigest: 'source:decide',
        instrumented: true,
        blocks: [
          block(0, 'module', 1, 6, ['alpha.test.ts', 'beta.test.ts']),
          block(1, 'function', 1, 6, ['alpha.test.ts', 'beta.test.ts']),
          block(2, 'branch', 2, 4, ['alpha.test.ts']),
          block(3, 'continuation', 5, 5, ['beta.test.ts']),
          { ...block(4, 'branch', 5, 5, ['alpha.test.ts']), source: false },
        ],
      }],
    };

    const report = await deviationFromView(
      openTestCoverage(encodeTestCoverage(coverage)),
      { root, records },
    );

    expect(report).toEqual({
      baseline: { files: 2, loc: 8 },
      coverage: { files: 1, loc: 6 },
      coverageRatio: 0.75,
      sensitivity: 1 / 3,
      tests: [
        {
          testFile: 'alpha.test.ts',
          baseline: { files: 2, loc: 8 },
          slice: { files: 1, loc: 5 },
          sensitivity: 0.625,
          deviation: 0.375,
        },
        {
          testFile: 'beta.test.ts',
          baseline: { files: 2, loc: 8 },
          slice: { files: 1, loc: 3 },
          sensitivity: 0.375,
          deviation: 0.625,
        },
        {
          testFile: 'type-only.test.ts',
          baseline: { files: 1, loc: 2 },
          slice: { files: 0, loc: 0 },
          sensitivity: 0,
          deviation: 1,
        },
      ],
    });
  });

  it('leaves an opaque static baseline absent instead of reporting zero', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'variance-deviation-'));
    roots.push(root);
    await writeFile(resolve(root, 'opaque.ts'), 'export const opaque = true;\n');
    const coverage: TestCoverage = {
      version: 2,
      instrumentation: 'fixture-instrumentation',
      tests: observations(['opaque.test.ts']),
      modules: [{
        file: 'opaque.ts',
        sourceDigest: 'source:opaque',
        instrumented: true,
        blocks: [block(0, 'module', 1, 1, ['opaque.test.ts'])],
      }],
    };
    const records: readonly FileRecord[] = [
      { file: 'opaque.test.ts', edges: [{ to: 'opaque.ts', kind: 'imports' }] },
      { file: 'opaque.ts', unknown: 'computed require()' },
    ];

    const report = await deviationFromView(
      openTestCoverage(encodeTestCoverage(coverage)),
      { root, records },
    );

    expect(report).toEqual({
      coverage: { files: 1, loc: 1 },
      tests: [{
        testFile: 'opaque.test.ts',
        slice: { files: 1, loc: 1 },
        unknown: ['opaque.ts: computed require()'],
      }],
    });
  });
});

function block(
  ordinal: number,
  kind: string,
  startLine: number,
  endLine: number,
  testFiles: readonly string[],
) {
  return {
    ordinal,
    kind,
    ...(ordinal === 0 ? {} : { owner: 0 }),
    digest: `block:${ordinal}`,
    name: kind === 'module' ? '' : 'decide',
    path: kind,
    startLine,
    endLine,
    source: true,
    testFiles,
  };
}

function observations(testFiles: readonly string[]) {
  return testFiles.map((file) => ({
    file,
    complete: true,
    preconditions: [{ name: file, digest: `source:${file}` }],
  }));
}
