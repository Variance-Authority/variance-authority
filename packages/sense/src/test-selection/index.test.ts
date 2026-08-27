import { describe, expect, it } from 'vitest';
import { encodeTestCoverage, openTestCoverage } from './format.js';
import { testCoverageFile, type TestCoverage } from './index.js';
import { selectTestFilesFromView } from './select.js';

const testFiles = ['test/aaa.test.ts', 'test/alpha.test.ts', 'test/beta.test.ts'];
const coverage: TestCoverage = {
  version: 2,
  instrumentation: 'fixture-instrumentation',
  tests: testFiles.map((file) => ({
    file,
    complete: true,
    preconditions: [
      { name: file, digest: `source:${file}` },
      { name: 'vitest.config.ts', digest: 'source:config' },
    ],
  })),
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

describe('selectTestFiles', () => {
  it('keeps the default snapshot outside the repository and keys it by root', () => {
    expect(testCoverageFile('/work/one', '/cache')).toMatch(
      /^\/cache\/variance-authority\/test-selection\/[a-f0-9]+\/coverage\.bin$/,
    );
    expect(testCoverageFile('/work/one', '/cache')).not.toBe(
      testCoverageFile('/work/two', '/cache'),
    );
  });

  it('returns test files from the innermost region changed by a unified diff', () => {
    const diff = `diff --git a/src/decide.ts b/src/decide.ts
--- a/src/decide.ts
+++ b/src/decide.ts
@@ -4,1 +4,1 @@
-    return 'A';
+    return 'Alpha';`;

    expect(selectTestFilesFromView(openTestCoverage(encodeTestCoverage(coverage)), diff)).toEqual([
      'test/alpha.test.ts',
    ]);
  });

  it('runs a test whose own file changed', () => {
    // Nothing enters a test file, so coverage has no module row for one. Read as
    // `no module, no tests`, a commit that adds or edits a test selected nothing
    // and the new test never ran.
    const diff = `--- a/test/alpha.test.ts
+++ b/test/alpha.test.ts
@@ -9,0 +10,3 @@
+it('covers the new case', () => {
+  expect(decide('x')).toBe('Alpha');
+});`;

    expect(selectTestFilesFromView(openTestCoverage(encodeTestCoverage(coverage)), diff)).toEqual([
      'test/alpha.test.ts',
    ]);
  });

  it('runs every test a changed precondition governs', () => {
    // What `preconditions` is for: runner configuration governs every test and is
    // entered by none of them.
    const diff = `--- a/vitest.config.ts
+++ b/vitest.config.ts
@@ -3,1 +3,1 @@
-    environment: 'node',
+    environment: 'jsdom',`;

    expect(selectTestFilesFromView(openTestCoverage(encodeTestCoverage(coverage)), diff)).toEqual(
      testFiles,
    );
  });

  it('stays silent for a changed file nothing records', () => {
    const diff = `--- a/README.md
+++ b/README.md
@@ -1,1 +1,1 @@
-# Old
+# New`;

    expect(selectTestFilesFromView(openTestCoverage(encodeTestCoverage(coverage)), diff)).toEqual(
      [],
    );
  });

  it('widens to the module when a changed line has no recorded region', () => {
    const diff = `--- a/src/decide.ts
+++ b/src/decide.ts
@@ -20,0 +21,1 @@
+export const added = true;`;

    expect(selectTestFilesFromView(openTestCoverage(encodeTestCoverage(coverage)), diff)).toEqual([
      'test/alpha.test.ts',
      'test/beta.test.ts',
    ]);
  });
});
