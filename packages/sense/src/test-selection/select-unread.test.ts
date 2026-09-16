import { describe, expect, it } from 'vitest';
import { encodeTestCoverage } from './format.js';
import { openTestCoverage } from './format-view.js';
import { type TestCoverage } from './index.js';
import { coverage, testFiles } from './__fixtures__/coverage.js';
import { narrowByExecutionFromView, selectTestFilesFromView } from './select.js';

describe('a changed file the recording cannot answer for', () => {
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
      stale: [],
      because: [],
    });
  });

  it('answers a changed module by its row, and does not call it unread because no test named it', () => {
    // No recorder declares a module it instrumented — the row already carries
    // the text — so nothing in the table mentions `src/decide.ts` and the row
    // is the only answer there is. Its silence is not the same sentence as
    // *nothing measured this*: the row measured it, and alpha alone entered the
    // branch.
    const diff = `--- a/src/decide.ts
+++ b/src/decide.ts
@@ -4,1 +4,1 @@
-    return 'A';
+    return 'a';`;

    expect(narrowByExecutionFromView(openTestCoverage(encodeTestCoverage(coverage)), diff)).toMatchObject({
      entered: ['test/alpha.test.ts'],
      unread: [],
      because: [
        {
          test: 'test/alpha.test.ts',
          via: [{ kind: 'region', file: 'src/decide.ts', name: 'decide', path: 'if#0/then', startLine: 3, endLine: 5 }],
        },
      ],
    });
  });

  it('runs a test that declares a changed file it entered nothing of, row or no row', () => {
    // The setup-file shape, and the shape of a snapshot merged from a run that
    // did not instrument this module. Every test declares `src/setup.ts`; only
    // alpha ever crossed a region of it. A declaration is unconditional — *if
    // this file's text moves, retire this observation* — so the row narrows
    // nothing: it is the whole record of why the two tests that entered none of
    // the module depend on it, and for alpha it stands beside the region.
    const setup = 'src/setup.ts';
    const configured: TestCoverage = {
      ...coverage,
      tests: coverage.tests.map((test) => ({
        ...test,
        preconditions: [...test.preconditions, { name: setup, digest: 'source:setup' }],
      })),
      modules: [
        ...coverage.modules,
        {
          file: setup,
          sourceDigest: 'source:setup',
          instrumented: true,
          blocks: [
            {
              ordinal: 0,
              kind: 'module',
              digest: 'block:setup',
              name: '',
              path: 'module',
              startLine: 1,
              endLine: 4,
              source: true,
              testFiles: ['test/alpha.test.ts'],
            },
          ],
        },
      ],
    };
    const diff = `--- a/${setup}
+++ b/${setup}
@@ -2,1 +2,1 @@
-  globalThis.clock = 0;
+  globalThis.clock = 1;`;

    expect(narrowByExecutionFromView(openTestCoverage(encodeTestCoverage(configured)), diff)).toMatchObject({
      entered: testFiles,
      unread: [],
      because: [
        { test: 'test/aaa.test.ts', via: [{ kind: 'precondition', name: setup }] },
        {
          test: 'test/alpha.test.ts',
          via: [
            { kind: 'region', file: setup, name: '', path: 'module', startLine: 1, endLine: 4 },
            { kind: 'precondition', name: setup },
          ],
        },
        { test: 'test/beta.test.ts', via: [{ kind: 'precondition', name: setup }] },
      ],
    });
  });

  it('runs a test whose own file changed, however the build also read that file', () => {
    // A test file inside the scanned source tree is two rows: a test, and a
    // module the build instrumented. Answering out of the module row alone
    // reads the one thing the row cannot say — a region the file's own tests
    // never entered has an empty audience, and an empty audience is not the
    // answer *nobody need run this*, it is the file editing itself. The record
    // says so in the one place that holds it: every recorder writes a test's
    // own file as a precondition of that test.
    const alpha = 'test/alpha.test.ts';
    const both: TestCoverage = {
      ...coverage,
      modules: [
        ...coverage.modules,
        {
          file: alpha,
          sourceDigest: 'source:alpha-module',
          instrumented: true,
          blocks: [
            {
              ordinal: 0,
              kind: 'module',
              digest: 'block:alpha:module',
              name: '',
              path: 'module',
              startLine: 1,
              endLine: 20,
              source: true,
              testFiles: [alpha],
            },
            {
              ordinal: 2,
              kind: 'branch',
              owner: 0,
              digest: 'block:alpha:else',
              name: 'helper',
              path: 'helper/else',
              startLine: 10,
              endLine: 12,
              source: true,
              testFiles: [],
            },
          ],
        },
      ],
    };
    const diff = `--- a/${alpha}
+++ b/${alpha}
@@ -11,1 +11,1 @@
-    return 'unreached';
+    return 'still unreached';`;

    expect(narrowByExecutionFromView(openTestCoverage(encodeTestCoverage(both)), diff)).toMatchObject({
      entered: [alpha],
      unread: [],
      because: [{ test: alpha, via: [{ kind: 'precondition', name: alpha }] }],
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
      stale: [],
      because: [],
    });
  });

  it('keeps a module unread when one build read it and another says it never did', () => {
    // Two rows under one path, which is what two builds reading one file look
    // like: the node build instrumented `src/widget.ts` and recorded a `render`
    // its own test crossed, and the browser build wrote `instrumented: false`
    // for it — *this build never read this module*. The second row says nothing
    // about the first build's subjects, and the first says nothing about the
    // second's: the browser subjects that render `render` hold neither a
    // crossing nor a declaration for it. Reading the instrumented row as the
    // path's answer hands the caller a skip list with those subjects still on
    // it, and a change to what they render goes out green.
    const twoBuilds: TestCoverage = {
      ...coverage,
      modules: [
        ...coverage.modules,
        { file: 'src/widget.ts', sourceDigest: 'source:widget', instrumented: false, blocks: [] },
        {
          file: 'src/widget.ts',
          sourceDigest: 'source:widget',
          instrumented: true,
          blocks: [
            {
              ordinal: 0,
              kind: 'module',
              digest: 'block:widget',
              name: '',
              path: 'module',
              startLine: 1,
              endLine: 30,
              source: true,
              testFiles: ['test/alpha.test.ts'],
            },
            {
              ordinal: 1,
              kind: 'function',
              owner: 0,
              digest: 'block:widget:render',
              name: 'render',
              path: 'render',
              startLine: 4,
              endLine: 9,
              source: true,
              testFiles: ['test/alpha.test.ts'],
            },
          ],
        },
      ],
    };
    const diff = `--- a/src/widget.ts
+++ b/src/widget.ts
@@ -6,1 +6,1 @@
-  return one;
+  return two;`;

    expect(narrowByExecutionFromView(openTestCoverage(encodeTestCoverage(twoBuilds)), diff)).toMatchObject({
      entered: ['test/alpha.test.ts'],
      unread: ['src/widget.ts'],
    });
  });

  it('keeps a file unread when one name it is held under was measured and another was not', () => {
    // `knownAs` is given precisely because one file is two names: this package's
    // own suite loads `src/decide.ts`, and every package downstream loads the
    // built twin the publish step wrote. The record holds the source name — the
    // row alpha and beta entered — and holds nothing whatever under
    // `dist/decide.js`, which is what a shard that never reached the fold looks
    // like, and what a build that carried no probes looks like.
    //
    // The source row witnesses the subjects that read the source. The tests that
    // loaded the built file are not in this snapshot to be missing from it, so
    // the source row cannot answer for them, and the file is unread however
    // fully the other name was measured. The alternative retires nothing and
    // hands the caller a skip list with a whole downstream package still on it.
    const diff = `--- a/src/decide.ts
+++ b/src/decide.ts
@@ -4,1 +4,1 @@
-    return 'A';
+    return 'a';`;
    const knownAs = (file: string): readonly string[] =>
      file === 'src/decide.ts' ? [file, 'dist/decide.js'] : [file];

    expect(
      narrowByExecutionFromView(openTestCoverage(encodeTestCoverage(coverage)), diff, { knownAs }),
    ).toMatchObject({ entered: ['test/alpha.test.ts'], unread: ['src/decide.ts'] });
  });

  it('answers a file whose every name was measured, and widens nothing', () => {
    // The same two names, and this time the snapshot holds both: `src/decide.ts`
    // by its row, `dist/decide.js` by the downstream test that declares it. Both
    // audiences are accounted for, so there is nothing left to report.
    const published: TestCoverage = {
      ...coverage,
      tests: coverage.tests.map((test) =>
        test.file === 'test/aaa.test.ts'
          ? { ...test, preconditions: [...test.preconditions, { name: 'dist/decide.js', digest: 'source:dist' }] }
          : test,
      ),
    };
    const diff = `--- a/src/decide.ts
+++ b/src/decide.ts
@@ -4,1 +4,1 @@
-    return 'A';
+    return 'a';`;
    const knownAs = (file: string): readonly string[] =>
      file === 'src/decide.ts' ? [file, 'dist/decide.js'] : [file];

    expect(
      narrowByExecutionFromView(openTestCoverage(encodeTestCoverage(published)), diff, { knownAs }),
    ).toMatchObject({ entered: ['test/aaa.test.ts', 'test/alpha.test.ts'], unread: [] });
  });
});
