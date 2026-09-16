import { describe, expect, it } from 'vitest';
import { encodeTestCoverage } from './format.js';
import { openTestCoverage } from './format-view.js';
import { type TestCoverage } from './index.js';
import { coverage } from './__fixtures__/coverage.js';
import { narrowByExecutionFromView, selectTestFilesFromView } from './select.js';

describe('charging a changed line to the regions that hold it', () => {
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

  it('charges nobody for added text the module never runs', () => {
    // An interface at the top of a module is charged to the gap it opens, and
    // at module level the regions on both sides of that gap are the module —
    // every test that ever imported the file. The compiler erases the text
    // before anything runs, so the honest answer is nobody.
    const diff = `--- a/src/decide.ts
+++ b/src/decide.ts
@@ -8,0 +9,4 @@
+
+export interface Described {
+  readonly n: number;
+}
`;

    expect(selectTestFilesFromView(openTestCoverage(encodeTestCoverage(coverage)), diff)).toEqual([]);
  });

  it('charges an added function declaration to the region the text landed in', () => {
    // The record holds `if#0/then` on lines 3 to 5, entered by alpha alone. A
    // `function` declaration inserted there hoists to the top of that branch
    // and binds its name over whatever the branch already called, so a line
    // above it that this hunk never touched answers differently afterwards,
    // and alpha is the test that would have caught it.
    //
    // Read as text that only binds a name, the hunk charges nobody: alpha
    // lands in the caller's skip list — `whole` minus `entered` — with nothing
    // in `unread` to clear it.
    const diff = `--- a/src/decide.ts
+++ b/src/decide.ts
@@ -4,0 +5,3 @@
+    function format(w) {
+      return 'local:' + w;
+    }
`;

    expect(narrowByExecutionFromView(openTestCoverage(encodeTestCoverage(coverage)), diff)).toMatchObject({
      entered: ['test/alpha.test.ts'],
      unread: [],
    });
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

  it('charges the region that opens on a line beside the narrower one that closes there', () => {
    // `} else if (score > bonus) {` on line 4 of `grade`. The record holds two
    // regions that touch that line and neither contains the other: the `then`
    // the line closes, lines 2 to 4 and crossed by alpha, and the `else` the
    // line opens, lines 4 to 8 and crossed by beta. The condition on that line
    // is the `else`'s own text, so an edit to it is an edit beta runs — the
    // narrower region merely ends there and its tests never evaluate it.
    //
    // Measured narrowest-first the `then` is the innermost thing on the line
    // and it closes rather than opens, so the walk outwards stops before the
    // `else` is ever asked. Beta is then absent from `entered` with nothing in
    // `unread` to rescue it, which puts the one test that catches the change on
    // the caller's safe skip list.
    const grading: TestCoverage = {
      ...coverage,
      modules: [
        ...coverage.modules,
        {
          file: 'src/grade.ts',
          sourceDigest: 'source:grade',
          instrumented: true,
          blocks: [
            {
              ordinal: 0,
              kind: 'module',
              digest: 'block:grade',
              name: '',
              path: 'module',
              startLine: 1,
              endLine: 10,
              source: true,
              testFiles: ['test/alpha.test.ts', 'test/beta.test.ts'],
            },
            {
              ordinal: 1,
              kind: 'function',
              owner: 0,
              digest: 'block:grade:entry',
              name: 'grade',
              path: 'grade',
              startLine: 1,
              endLine: 10,
              source: true,
              testFiles: ['test/alpha.test.ts', 'test/beta.test.ts'],
            },
            {
              ordinal: 2,
              kind: 'branch',
              owner: 1,
              digest: 'block:grade:then',
              name: 'grade',
              path: 'if#0/then',
              startLine: 2,
              endLine: 4,
              source: true,
              testFiles: ['test/alpha.test.ts'],
            },
            {
              ordinal: 3,
              kind: 'branch',
              owner: 1,
              digest: 'block:grade:else',
              name: 'grade',
              path: 'if#0/else',
              startLine: 4,
              endLine: 8,
              source: true,
              testFiles: ['test/beta.test.ts'],
            },
          ],
        },
      ],
    };
    const diff = `--- a/src/grade.ts
+++ b/src/grade.ts
@@ -4,1 +4,1 @@
-  } else if (score > bonus) {
+  } else if (score > bonus + 40) {`;

    const narrowed = narrowByExecutionFromView(openTestCoverage(encodeTestCoverage(grading)), diff);

    expect(narrowed).toMatchObject({
      entered: ['test/alpha.test.ts', 'test/beta.test.ts'],
      unread: [],
    });
    expect(narrowed.because.find(({ test }) => test === 'test/beta.test.ts')?.via).toContainEqual({
      kind: 'region',
      file: 'src/grade.ts',
      name: 'grade',
      path: 'if#0/else',
      startLine: 4,
      endLine: 8,
    });
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
