import { describe, expect, it } from 'vitest';
import { selectTestFiles, type TestCoverage } from './index.js';

const coverage: TestCoverage = {
  version: 1,
  modules: [
    {
      file: 'src/decide.ts',
      blocks: [
        {
          ordinal: 0,
          kind: 'module',
          name: '',
          path: 'module',
          startLine: 1,
          endLine: 8,
          testFiles: ['test/alpha.test.ts', 'test/beta.test.ts'],
        },
        {
          ordinal: 2,
          kind: 'branch',
          name: 'decide',
          path: 'if#0/then',
          startLine: 3,
          endLine: 5,
          testFiles: ['test/alpha.test.ts'],
        },
      ],
    },
  ],
};

describe('selectTestFiles', () => {
  it('returns test files from the innermost region changed by a unified diff', () => {
    const diff = `diff --git a/src/decide.ts b/src/decide.ts
--- a/src/decide.ts
+++ b/src/decide.ts
@@ -4,1 +4,1 @@
-    return 'A';
+    return 'Alpha';`;

    expect(selectTestFiles(coverage, diff)).toEqual(['test/alpha.test.ts']);
  });

  it('widens to the module when a changed line has no recorded region', () => {
    const diff = `--- a/src/decide.ts
+++ b/src/decide.ts
@@ -20,0 +21,1 @@
+export const added = true;`;

    expect(selectTestFiles(coverage, diff)).toEqual([
      'test/alpha.test.ts',
      'test/beta.test.ts',
    ]);
  });
});
