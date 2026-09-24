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

  it('reports a changed file nothing holds beside the selection', () => {
    // The silence above, said out loud. It selects nobody either way; the
    // report is where a suite that reads the file with `fs` learns to declare
    // it.
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
      readings: [],
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

  it('reports a module the build could not instrument rather than reading its silence', () => {
    // A row with no blocks behind it, and no test holding it. Its emptiness is
    // the build saying it never parsed this module, not the journal saying
    // nothing entered it, so it is no measurement: it selects nobody, and is
    // reported the way a file nothing holds is.
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
      readings: [],
      because: [],
    });
  });

  it('answers a module by the build that read it, whatever another build says it never did', () => {
    // Two rows under one path, which is what two builds reading one file look
    // like: the node build instrumented `src/widget.ts` and recorded a `render`
    // its own test crossed, and the browser build wrote `instrumented: false`
    // for it — *this build never read this module*. That is no measurement, so
    // it takes nothing from the row beside it, which is one.
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
      unread: [],
    });
  });

  it('answers a file by the name that was measured, whatever the name beside it holds', () => {
    // `knownAs` is given because one file is two names: this package's own
    // suite loads `src/decide.ts`, and every package downstream loads the built
    // twin the publish step wrote. The record holds the source name — the row
    // alpha and beta entered — and nothing under `dist/decide.js`. Each name
    // selects its own audience; the one with none selects nobody and does not
    // report the file.
    const diff = `--- a/src/decide.ts
+++ b/src/decide.ts
@@ -4,1 +4,1 @@
-    return 'A';
+    return 'a';`;
    const knownAs = (file: string): readonly string[] =>
      file === 'src/decide.ts' ? [file, 'dist/decide.js'] : [file];

    expect(
      narrowByExecutionFromView(openTestCoverage(encodeTestCoverage(coverage)), diff, { knownAs }),
    ).toMatchObject({ entered: ['test/alpha.test.ts'], unread: [] });
  });

  it('selects the audience of every name a file is held under', () => {
    // The same two names, and this time the snapshot holds both: `src/decide.ts`
    // by its row, `dist/decide.js` by the downstream test that declares it.
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
