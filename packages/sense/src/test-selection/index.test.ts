import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeTestCoverage, encodeTestCoverage, openTestCoverage } from './format.js';
import { readTestCoverage, testCoverageFile, type TestCoverage } from './index.js';
import { narrowByExecutionFromView, selectTestFilesFromView } from './select.js';

const testFiles = ['test/aaa.test.ts', 'test/alpha.test.ts', 'test/beta.test.ts'];
const coverage: TestCoverage = {
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

describe('narrowByExecution', () => {
  const diff = `--- a/src/decide.ts
+++ b/src/decide.ts
@@ -4,1 +4,1 @@
-    return 'A';
+    return 'Alpha';`;

  it('answers who it speaks for beside who the diff reached', () => {
    // The selection alone is a licence to exclude, and it does not carry the one
    // fact that makes an exclusion honest: whether this snapshot ever observed
    // the thing being excluded, and observed it whole.
    expect(narrowByExecutionFromView(openTestCoverage(encodeTestCoverage(coverage)), diff)).toEqual({
      whole: testFiles,
      entered: ['test/alpha.test.ts'],
      unread: [],
    });
  });

  it('leaves a partial observation out of `whole` while it stays in `entered`', () => {
    // An upper bound cannot justify an exclusion and is perfectly good grounds
    // for running something. The two lists are asymmetric on purpose.
    const partial: TestCoverage = {
      ...coverage,
      tests: coverage.tests.map((test) =>
        test.file === 'test/alpha.test.ts' ? { ...test, complete: false } : test,
      ),
    };

    expect(narrowByExecutionFromView(openTestCoverage(encodeTestCoverage(partial)), diff)).toEqual({
      whole: ['test/aaa.test.ts', 'test/beta.test.ts'],
      entered: ['test/alpha.test.ts'],
      unread: [],
    });
  });
});

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

  it('names a changed file it has no measurement of instead of answering for it', () => {
    // The silence above, said out loud. `[]` and *nobody entered this* are the
    // same empty list, and only one of them licenses a caller to skip a suite.
    const diff = `--- a/README.md
+++ b/README.md
@@ -1,1 +1,1 @@
-# Old
+# New`;

    expect(narrowByExecutionFromView(openTestCoverage(encodeTestCoverage(coverage)), diff)).toEqual({
      whole: testFiles,
      entered: [],
      unread: ['README.md'],
    });
  });

  it('counts a changed precondition as measured rather than unread', () => {
    const diff = `--- a/vitest.config.ts
+++ b/vitest.config.ts
@@ -3,1 +3,1 @@
-    environment: 'node',
+    environment: 'jsdom',`;

    expect(
      narrowByExecutionFromView(openTestCoverage(encodeTestCoverage(coverage)), diff).unread,
    ).toEqual([]);
  });

  it('names a module the build could not instrument rather than reading its silence', () => {
    // A row with no blocks behind it. The lookup succeeds, so the file is not
    // unknown the way `README.md` is — and its emptiness is the build saying it
    // never parsed this module, not the journal saying nothing entered it.
    // Selecting nobody would be an answer, and there is no answer here.
    const unparsed: TestCoverage = {
      ...coverage,
      modules: [
        ...coverage.modules,
        { file: 'src/unparsed.ts', sourceDigest: 'source:unparsed', instrumented: false, blocks: [] },
      ],
    };
    const diff = `--- a/src/unparsed.ts
+++ b/src/unparsed.ts
@@ -2,1 +2,1 @@
-  return 1;
+  return 2;`;

    expect(narrowByExecutionFromView(openTestCoverage(encodeTestCoverage(unparsed)), diff)).toEqual({
      whole: testFiles,
      entered: [],
      unread: ['src/unparsed.ts'],
    });
  });

  it('unions two hunks in one file rather than letting the deeper one erase the other', () => {
    // The regression that skipped two of three subjects over a change to what
    // they render. An added import matches the module root — crossed by every
    // test in the bundle — and a line inside a branch matches the branch. Asked
    // for the innermost region of the *file* rather than of each hunk, the root
    // is dropped for containing the branch, and `alpha ∪ beta` comes back as
    // `alpha`.
    const diff = `--- a/src/decide.ts
+++ b/src/decide.ts
@@ -1,2 +1,3 @@
+import { added } from './added.js';
@@ -4,1 +5,1 @@
-    return 'A';
+    return 'Alpha';`;

    expect(selectTestFilesFromView(openTestCoverage(encodeTestCoverage(coverage)), diff)).toEqual([
      'test/alpha.test.ts',
      'test/beta.test.ts',
    ]);
  });

  it('charges a hunk’s context lines to nobody', () => {
    // The edit is one line inside the branch; the six around it are printed so a
    // human can find the place. Counted as changed, they reach the module root
    // and `beta` — which never entered the branch — is selected by an edit it
    // could not have run. This is the whole distance between *the effect every
    // subject mounts* and *the handler one subject clicks*.
    const diff = `--- a/src/decide.ts
+++ b/src/decide.ts
@@ -2,5 +2,5 @@
 const value = read();
 if (value) {
-    return 'A';
+    return 'Alpha';
 }
 return 'B';`;

    expect(selectTestFilesFromView(openTestCoverage(encodeTestCoverage(coverage)), diff)).toEqual([
      'test/alpha.test.ts',
    ]);
  });

  it('charges an inserted line to the regions on both sides of the gap', () => {
    // A pure insertion has no old line of its own. Which region the new text
    // joins is knowable from the old file only as *one of these two*, and the
    // union of them is the honest answer.
    const diff = `--- a/src/decide.ts
+++ b/src/decide.ts
@@ -4,1 +4,2 @@
     return 'A';
+    // reviewed
`;

    expect(selectTestFilesFromView(openTestCoverage(encodeTestCoverage(coverage)), diff)).toEqual([
      'test/alpha.test.ts',
    ]);
  });

  it('charges three lines replacing one to the region the one was in', () => {
    // A run’s removals and additions have no correspondence in count, and the
    // extra additions are not a separate insertion after them. Read as one,
    // guarding an `onClick` with a confirmation charges the two lines below the
    // handler — the component body — and the two subjects that never clicked it
    // are selected by an edit they cannot reach.
    const diff = `--- a/src/decide.ts
+++ b/src/decide.ts
@@ -4,1 +4,3 @@
-    return 'A';
+    if (ready) {
+      return 'Alpha';
+    }`;

    expect(selectTestFilesFromView(openTestCoverage(encodeTestCoverage(coverage)), diff)).toEqual([
      'test/alpha.test.ts',
    ]);
  });

  it('answers for a deleted file out of the coordinates it still has', () => {
    // `+++ /dev/null` is the whole header a deletion offers on the new side, and
    // its hunks are entirely old lines — the side the journal is indexed by. Read
    // off `+++` alone the commit changed no file at all, so removing a module
    // every test crosses contributed nothing to the selection.
    const diff = `diff --git a/src/decide.ts b/src/decide.ts
deleted file mode 100644
--- a/src/decide.ts
+++ /dev/null
@@ -1,8 +0,0 @@
-export const decide = () => 'A';`;

    expect(selectTestFilesFromView(openTestCoverage(encodeTestCoverage(coverage)), diff)).toEqual([
      'test/alpha.test.ts',
      'test/beta.test.ts',
    ]);
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

describe('readTestCoverage', () => {
  it('returns the entered regions a run recorded, not a summary of them', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-read-coverage-'));
    const file = resolve(directory, 'coverage.bin');
    await writeFile(file, encodeTestCoverage(coverage));

    try {
      const read = await readTestCoverage(file);

      // The whole point of the reader: which blocks exist, and which test files
      // entered each one. `selectTestFiles` answers with paths and
      // `deviationOfTests` with line counts; neither can show this.
      expect(read).toEqual(decoded(coverage));
      expect(read.modules.map((module) => module.file)).toContain('src/decide.ts');
      expect(
        read.modules
          .flatMap((module) => module.blocks)
          .some((block) => block.testFiles.length > 0),
      ).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('refuses a file that is not a coverage snapshot', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-read-coverage-'));
    const file = resolve(directory, 'coverage.bin');
    await writeFile(file, 'not a snapshot');

    try {
      await expect(readTestCoverage(file)).rejects.toThrow(
        /not a variance-authority test coverage artifact/,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

/** What a round trip through the binary format normalizes the fixture to. */
function decoded(input: TestCoverage): TestCoverage {
  return decodeTestCoverage(encodeTestCoverage(input));
}
