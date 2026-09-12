import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeTestCoverage, encodeTestCoverage } from './format.js';
import { openTestCoverage } from './format-view.js';
import { readTestCoverage, testCoverageFile, writeTestCoverage, type TestCoverage } from './index.js';
import { coverage, testFiles } from './__fixtures__/coverage.js';
import { narrowByExecutionFromView, selectTestFilesFromView } from './select.js';

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
      because: [
        {
          test: 'test/alpha.test.ts',
          via: [
            { kind: 'region', file: 'src/decide.ts', name: 'decide', path: 'if#0/then', startLine: 3, endLine: 5 },
          ],
        },
      ],
    });
  });

  it('says which precondition selected a test, and which regions, in one list', () => {
    // The three ways in are fixed in three different places — a probe, a
    // declaration, a dependency — and a list of paths cannot say which one
    // put a test there. The reasons are the facts the loop held anyway.
    const diff = `--- a/src/decide.ts
+++ b/src/decide.ts
@@ -1,1 +1,1 @@
-import { a } from './a';
+import { a, b } from './a';
--- a/test/beta.test.ts
+++ b/test/beta.test.ts
@@ -1,1 +1,1 @@
-old
+new`;

    expect(narrowByExecutionFromView(openTestCoverage(encodeTestCoverage(coverage)), diff).because).toEqual([
      {
        test: 'test/alpha.test.ts',
        via: [{ kind: 'region', file: 'src/decide.ts', name: '', path: 'module', startLine: 1, endLine: 8 }],
      },
      {
        test: 'test/beta.test.ts',
        via: [
          { kind: 'region', file: 'src/decide.ts', name: '', path: 'module', startLine: 1, endLine: 8 },
          { kind: 'precondition', name: 'test/beta.test.ts' },
        ],
      },
    ]);
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

    expect(narrowByExecutionFromView(openTestCoverage(encodeTestCoverage(partial)), diff)).toMatchObject({
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
      because: [],
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
      because: [],
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
+    audit(sum);
`;

    expect(selectTestFilesFromView(openTestCoverage(encodeTestCoverage(coverage)), diff)).toEqual([
      'test/alpha.test.ts',
    ]);
  });

  it('charges nobody for added text that only binds a name', () => {
    // A function at the top of a module is charged to the gap it opens, and at
    // module level the regions on both sides of that gap are the module — every
    // test that ever imported the file. Nothing that already ran can reach a
    // name nothing that already ran mentions, so the honest answer is nobody.
    const diff = `--- a/src/decide.ts
+++ b/src/decide.ts
@@ -8,0 +9,4 @@
+
+export function describe(n: number): string {
+  return String(n);
+}
`;

    expect(selectTestFilesFromView(openTestCoverage(encodeTestCoverage(coverage)), diff)).toEqual([]);
  });

  it('charges an added top-level binding that runs to everyone who imported the module', () => {
    // The same shape of hunk, and the initializer runs while the module
    // evaluates, which is work every importer consumed.
    const diff = `--- a/src/decide.ts
+++ b/src/decide.ts
@@ -8,0 +9,1 @@
+const scale = compute();
`;

    expect(selectTestFilesFromView(openTestCoverage(encodeTestCoverage(coverage)), diff)).toEqual([
      'test/alpha.test.ts',
      'test/beta.test.ts',
    ]);
  });

  it('charges three lines replacing one to the region the one was in, and the gap they open after it', () => {
    // A run’s removals and additions have no correspondence in count. The
    // additions past the count removed open a gap after the removed line, and
    // the gap is charged to the regions on both sides of it; here both sides
    // are the branch, so guarding the `return` selects alpha alone.
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

describe('writeTestCoverage', () => {
  it('writes what readTestCoverage reads back, creating the directory on the way', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-write-coverage-'));
    const file = resolve(directory, 'test-selection', 'nested', 'coverage.bin');

    try {
      await writeTestCoverage(file, coverage);

      expect(await readTestCoverage(file)).toEqual(decoded(coverage));
      // Whole or not at all: the temporary file the rename came from is gone,
      // so a reader of the directory sees one snapshot and never a half of one.
      expect(await readdir(resolve(directory, 'test-selection', 'nested'))).toEqual(['coverage.bin']);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

/** What a round trip through the binary format normalizes the fixture to. */
function decoded(input: TestCoverage): TestCoverage {
  return decodeTestCoverage(encodeTestCoverage(input));
}
