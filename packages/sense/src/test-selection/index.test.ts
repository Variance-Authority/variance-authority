import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { digestString } from '../digest.js';
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
      stale: [],
      readings: [{ file: 'src/decide.ts', unread: 'source' }],
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

  // A recording is made by *running* the suite, so the text its line numbers
  // were cut from is the working tree's, while the label on the snapshot is
  // `git rev-parse HEAD`. In the loop this is most wanted in the two are never
  // the same text, and every hunk a later diff produces is then charged to
  // whatever region happens to occupy those numbers now.
  describe('a recording cut from a different text than the diff is written against', () => {
    const decided = "// Decides.\nexport function decide(value) {\n  if (value) {\n    return 'A';\n  }\n  return 'B';\n}\n";
    const dated: TestCoverage = {
      ...coverage,
      modules: coverage.modules.map((module) =>
        module.file === 'src/decide.ts' ? { ...module, sourceDigest: digestString(decided) } : module,
      ),
    };
    const view = (): ReturnType<typeof openTestCoverage> =>
      openTestCoverage(encodeTestCoverage(dated));

    it('reads the line ranges when the text at the position hashes to what was recorded', () => {
      expect(narrowByExecutionFromView(view(), diff, { sourceAt: () => decided })).toMatchObject({
        entered: ['test/alpha.test.ts'],
        stale: [],
        readings: [{ file: 'src/decide.ts', verdict: 'bodies', names: [] }],
      });
    });

    it('reads the lines alone, and says so, when the diff does not apply to the recorded text', () => {
      // The digest agrees, so the numbers are coordinates; the removed line is
      // not the recorded one, so there is no second text to parse.
      const moved = decided.replace("return 'A';", "return 'Z';");
      const recorded: TestCoverage = {
        ...dated,
        modules: dated.modules.map((module) =>
          module.file === 'src/decide.ts' ? { ...module, sourceDigest: digestString(moved) } : module,
        ),
      };
      expect(
        narrowByExecutionFromView(openTestCoverage(encodeTestCoverage(recorded)), diff, { sourceAt: () => moved }),
      ).toMatchObject({
        entered: ['test/alpha.test.ts'],
        stale: [],
        readings: [{ file: 'src/decide.ts', unread: 'hunk' }],
      });
    });

    it('charges the module whole, and names it, when it does not', () => {
      // The widest honest answer. The numbers in the snapshot are coordinates in
      // a text nobody here has, so the only region the diff can be charged to is
      // the module itself — every test that ever entered it.
      expect(
        narrowByExecutionFromView(view(), diff, { sourceAt: () => `${decided}// edited\n` }),
      ).toMatchObject({
        entered: ['test/alpha.test.ts', 'test/beta.test.ts'],
        stale: ['src/decide.ts'],
      });
    });

    it('treats a file the position does not hold as the same disagreement', () => {
      expect(narrowByExecutionFromView(view(), diff, { sourceAt: () => undefined })).toMatchObject({
        entered: ['test/alpha.test.ts', 'test/beta.test.ts'],
        stale: ['src/decide.ts'],
      });
    });

    it('asks for the text at the position the snapshot names, not at the tree', () => {
      const asked: Array<readonly [string, string | undefined]> = [];
      narrowByExecutionFromView(view(), diff, {
        sourceAt: (file, commit) => {
          asked.push([file, commit]);
          return decided;
        },
      });

      expect(asked).toEqual([['src/decide.ts', undefined]]);
    });

    it('reads the ranges on trust when no caller asked, which is what it always did', () => {
      // Empty because nothing looked is not the same fact as empty because
      // everything agreed, and a caller that cannot fetch a text from a commit
      // is not owed a guess.
      expect(narrowByExecutionFromView(view(), diff)).toMatchObject({
        entered: ['test/alpha.test.ts'],
        stale: [],
        readings: [{ file: 'src/decide.ts', unread: 'source' }],
      });
    });
  });
});

describe('selectTestFiles', () => {
  it('keeps the snapshot in the cache it is given and keys it by root', () => {
    expect(testCoverageFile('/work/one', '/cache')).toMatch(
      /^\/cache\/test-selection\/[a-f0-9]+\/coverage\.bin$/,
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
