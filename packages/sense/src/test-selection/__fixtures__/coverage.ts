/**
 * One snapshot: three tests, two modules, a branch only one of them took.
 *
 * `test/aaa.test.ts` entered `src/aaa.ts` and nothing else. `test/alpha.test.ts`
 * and `test/beta.test.ts` both evaluated `src/decide.ts`, and alpha alone took
 * the `then` branch on lines 3 to 5. Every test is governed by its own file,
 * `vitest.config.ts`, and the module it loaded, the way a seam records every
 * module a test entered. Shared by the files that test the selector rather than
 * copied into each, because what the questions differ in is the diff and the
 * graph, never the recording.
 */

import type { TestCoverage } from '../index.js';

export const testFiles = ['test/aaa.test.ts', 'test/alpha.test.ts', 'test/beta.test.ts'];
export const coverage: TestCoverage = {
  version: 3,
  instrumentation: 'fixture-instrumentation',
  tests: testFiles.map((file) => {
    const loaded = file === 'test/aaa.test.ts' ? 'src/aaa.ts' : 'src/decide.ts';
    return {
      file,
      complete: true,
      preconditions: [
        { name: loaded, digest: `source:${loaded}` },
        { name: file, digest: `source:${file}` },
        { name: 'vitest.config.ts', digest: 'source:config' },
      ],
    };
  }),
  modules: [
    {
      file: 'src/aaa.ts',
      sourceDigest: 'source:aaa',
      instrumented: true,
      blocks: [
        {
          ordinal: 0,
          kind: 'module',
          digest: 'block:aaa',
          name: '',
          path: 'module',
          startLine: 1,
          endLine: 1,
          source: true,
          testFiles: ['test/aaa.test.ts'],
        },
      ],
    },
    {
      file: 'src/decide.ts',
      sourceDigest: 'source:decide',
      instrumented: true,
      blocks: [
        {
          ordinal: 0,
          kind: 'module',
          digest: 'block:decide',
          name: '',
          path: 'module',
          startLine: 1,
          endLine: 8,
          source: true,
          testFiles: ['test/alpha.test.ts', 'test/beta.test.ts'],
        },
        {
          ordinal: 2,
          kind: 'branch',
          owner: 0,
          digest: 'block:decide:then',
          name: 'decide',
          path: 'if#0/then',
          startLine: 3,
          endLine: 5,
          source: true,
          testFiles: ['test/alpha.test.ts'],
        },
      ],
    },
  ],
};
