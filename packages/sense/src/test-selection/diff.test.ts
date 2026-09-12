import { describe, expect, it } from 'vitest';
import { encodeTestCoverage } from './format.js';
import { openTestCoverage } from './format-view.js';
import type { TestCoverage } from './index.js';
import { narrowByExecutionFromView, selectTestFilesFromView } from './select.js';
import { coverage } from './__fixtures__/coverage.js';

/**
 * The shapes a diff takes that a hunk header alone does not explain, and the
 * shapes a snapshot takes that a line range alone does not resolve. Each one
 * read wrongly skips a test over an edit it ran.
 */

const view = (snapshot: TestCoverage = coverage) => openTestCoverage(encodeTestCoverage(snapshot));

describe('an insertion with nothing removed', () => {
  it('is charged to the line it follows and the line after, not the two before', () => {
    // `@@ -5,0 +6,1 @@`: the new line sits between old lines 5 and 6. Line 5 is
    // the branch only alpha took; line 6 is the module both entered. Read as a
    // span ending at 5, it charges lines 4 and 5 and beta is skipped over a
    // line it will run.
    const diff = `--- a/src/decide.ts
+++ b/src/decide.ts
@@ -5,0 +6,1 @@
+  log('left the branch');`;

    expect(selectTestFilesFromView(view(), diff)).toEqual(['test/alpha.test.ts', 'test/beta.test.ts']);
  });

  it('at the top of a file lands on its first line', () => {
    const diff = `--- a/src/aaa.ts
+++ b/src/aaa.ts
@@ -0,0 +1,1 @@
+import './side-effect.js';`;

    expect(selectTestFilesFromView(view(), diff)).toEqual(['test/aaa.test.ts']);
  });
});

describe('a run of additions longer than the removals it replaces', () => {
  it('charges the excess to what follows the last removed line as well', () => {
    // Line 5 closes the branch only alpha took; line 6 is the module both
    // entered. Replacing the brace with the brace and two statements puts the
    // statements after the branch, where beta runs them. Read as the branch
    // alone, beta is skipped over two lines it will execute.
    const diff = `--- a/src/decide.ts
+++ b/src/decide.ts
@@ -5,1 +5,3 @@
-  }
+  }
+  log();
+  more();`;

    expect(selectTestFilesFromView(view(), diff)).toEqual(['test/alpha.test.ts', 'test/beta.test.ts']);
  });

  it('charges a replacement matched line for line to the removed lines alone', () => {
    const diff = `--- a/src/decide.ts
+++ b/src/decide.ts
@@ -4,2 +4,2 @@
-    return 'A';
-  }
+    return 'a';
+  }`;

    expect(selectTestFilesFromView(view(), diff)).toEqual(['test/alpha.test.ts']);
  });
});

describe('a file the diff names without a hunk', () => {
  it('charges a binary, a pure rename, and a mode change whole', () => {
    // None of the three has a `---`/`+++` pair under its `diff --git` line, and
    // a reader keyed off those headers never sees the file at all: not entered,
    // not unread, gone.
    const diff = `diff --git a/src/decide.ts b/src/decide.ts
old mode 100644
new mode 100755
diff --git a/assets/logo.png b/assets/logo.png
Binary files a/assets/logo.png and b/assets/logo.png differ
diff --git a/src/aaa.ts b/src/renamed.ts
similarity index 100%
rename from src/aaa.ts
rename to src/renamed.ts
diff --git a/vitest.config.ts b/vitest.config.ts
--- a/vitest.config.ts
+++ b/vitest.config.ts
@@ -1,1 +1,1 @@
-old
+new`;

    expect(narrowByExecutionFromView(view(), diff)).toMatchObject({
      entered: ['test/aaa.test.ts', 'test/alpha.test.ts', 'test/beta.test.ts'],
      unread: ['assets/logo.png', 'src/renamed.ts'],
      because: [
        {
          test: 'test/aaa.test.ts',
          via: [
            { kind: 'region', file: 'src/aaa.ts', path: 'module' },
            { kind: 'precondition', name: 'vitest.config.ts' },
          ],
        },
        {
          test: 'test/alpha.test.ts',
          via: [
            { kind: 'region', file: 'src/decide.ts', path: 'module' },
            { kind: 'region', file: 'src/decide.ts', path: 'if#0/then' },
            { kind: 'precondition', name: 'vitest.config.ts' },
          ],
        },
        {
          test: 'test/beta.test.ts',
          via: [
            { kind: 'region', file: 'src/decide.ts', path: 'module' },
            { kind: 'precondition', name: 'vitest.config.ts' },
          ],
        },
      ],
    });
  });
});

describe('a rename with an edit', () => {
  it('reads the hunks under the old name and asks the graph about the new one', () => {
    // The old-side numbers are `src/decide.ts`'s, the name the rows are under:
    // line 4 is the branch only alpha took. `src/moved.ts` has no row, and is
    // named whole so an importer of the new name is found, or it is unread.
    const diff = `diff --git a/src/decide.ts b/src/moved.ts
similarity index 90%
rename from src/decide.ts
rename to src/moved.ts
--- a/src/decide.ts
+++ b/src/moved.ts
@@ -4,1 +4,1 @@
-    return 'A';
+    return 'a';`;

    expect(narrowByExecutionFromView(view(), diff)).toMatchObject({
      entered: ['test/alpha.test.ts'],
      unread: ['src/moved.ts'],
      because: [
        { test: 'test/alpha.test.ts', via: [{ kind: 'region', file: 'src/decide.ts', path: 'if#0/then' }] },
      ],
    });
  });
});

describe('a region nobody wrote', () => {
  it('adds its crossings on its line and never decides the line alone', () => {
    // The implicit `else` of the `if` on lines 3 to 5 is a zero-span region at
    // the closing brace. beta took it; alpha took the written branch. An edit
    // to line 5 is inside the branch alpha ran, and the narrowest region there
    // must not be the one with no source — that would skip alpha.
    const withElse: TestCoverage = {
      ...coverage,
      modules: coverage.modules.map((module) =>
        module.file === 'src/decide.ts'
          ? {
              ...module,
              blocks: [
                ...module.blocks,
                {
                  ordinal: 3,
                  kind: 'branch',
                  owner: 0,
                  digest: 'block:decide:else',
                  name: 'decide',
                  path: 'if#0/else',
                  startLine: 5,
                  endLine: 5,
                  source: false,
                  testFiles: ['test/beta.test.ts'],
                },
              ],
            }
          : module,
      ),
    };
    const diff = `--- a/src/decide.ts
+++ b/src/decide.ts
@@ -5,1 +5,1 @@
-  }
+  } // closes the branch`;

    expect(narrowByExecutionFromView(view(withElse), diff).because).toEqual([
      {
        test: 'test/alpha.test.ts',
        via: [{ kind: 'region', file: 'src/decide.ts', name: 'decide', path: 'if#0/then', startLine: 3, endLine: 5 }],
      },
      {
        test: 'test/beta.test.ts',
        via: [{ kind: 'region', file: 'src/decide.ts', name: 'decide', path: 'if#0/else', startLine: 5, endLine: 5 }],
      },
    ]);
  });
});

describe('a line on the boundary of a region', () => {
  // The `then` branch is lines 3 to 5 of `src/decide.ts`; alpha alone entered
  // it, and beta entered the module. Line 3 opens the branch and holds the
  // condition, which is the module's text; line 4 is the branch's alone, and so
  // is the brace on line 5 that closes it.
  const edit = (line: number) => `--- a/src/decide.ts
+++ b/src/decide.ts
@@ -${line},1 +${line},1 @@
-old
+new`;

  it('that opens the region is the enclosing region\'s line too, so the tests that never entered the region run', () => {
    expect(narrowByExecutionFromView(view(), edit(3)).because).toEqual([
      {
        test: 'test/alpha.test.ts',
        via: [
          { kind: 'region', file: 'src/decide.ts', name: 'decide', path: 'if#0/then', startLine: 3, endLine: 5 },
          { kind: 'region', file: 'src/decide.ts', name: '', path: 'module', startLine: 1, endLine: 8 },
        ],
      },
      {
        test: 'test/beta.test.ts',
        via: [{ kind: 'region', file: 'src/decide.ts', name: '', path: 'module', startLine: 1, endLine: 8 }],
      },
    ]);
  });

  it('inside the region, or on the brace that closes a branch, is the region\'s alone', () => {
    expect(narrowByExecutionFromView(view(), edit(4)).entered).toEqual(['test/alpha.test.ts']);
    expect(narrowByExecutionFromView(view(), edit(5)).entered).toEqual(['test/alpha.test.ts']);
  });

  it('that resumes after an await, or after two, is the line of the function around it', () => {
    // `const data = await (await fetch(url)).json();` on line 2 of a function:
    // the text before the first `await` is the function's. rejects entered the
    // function and never resumed; ok resumed twice. Both ran what the line holds.
    const awaited: TestCoverage = {
      ...coverage,
      modules: [
        {
          file: 'src/load.ts',
          sourceDigest: 'source:load',
          instrumented: true,
          blocks: [
            { ordinal: 0, kind: 'module', digest: 'l:0', name: '', path: 'module', startLine: 1, endLine: 4, source: true, testFiles: ['test/alpha.test.ts', 'test/beta.test.ts'] },
            { ordinal: 1, kind: 'function', owner: 0, digest: 'l:1', name: 'load', path: 'entry', startLine: 1, endLine: 4, source: true, testFiles: ['test/alpha.test.ts', 'test/beta.test.ts'] },
            { ordinal: 2, kind: 'resume', owner: 1, digest: 'l:2', name: 'load', path: 'await#0', startLine: 2, endLine: 3, source: true, testFiles: ['test/alpha.test.ts'] },
            { ordinal: 3, kind: 'resume', owner: 1, digest: 'l:3', name: 'load', path: 'await#1', startLine: 2, endLine: 3, source: true, testFiles: ['test/alpha.test.ts'] },
          ],
        },
      ],
    };
    const diff = (line: number) => `--- a/src/load.ts
+++ b/src/load.ts
@@ -${line},1 +${line},1 @@
-old
+new`;

    expect(narrowByExecutionFromView(view(awaited), diff(2)).entered).toEqual(['test/alpha.test.ts', 'test/beta.test.ts']);
    expect(narrowByExecutionFromView(view(awaited), diff(3)).entered).toEqual(['test/alpha.test.ts']);
  });

  it('that closes a function is the enclosing region\'s line too', () => {
    // A handler declared inside a component: `}, [a]);` closes the arrow and
    // carries the component's dependency list. render entered the component
    // and never the handler.
    const handler: TestCoverage = {
      ...coverage,
      modules: [
        {
          file: 'src/button.ts',
          sourceDigest: 'source:button',
          instrumented: true,
          blocks: [
            { ordinal: 0, kind: 'module', digest: 'b:0', name: '', path: 'module', startLine: 1, endLine: 6, source: true, testFiles: ['test/alpha.test.ts', 'test/beta.test.ts'] },
            { ordinal: 1, kind: 'function', owner: 0, digest: 'b:1', name: 'Button', path: 'entry', startLine: 1, endLine: 6, source: true, testFiles: ['test/alpha.test.ts', 'test/beta.test.ts'] },
            { ordinal: 2, kind: 'function', owner: 1, digest: 'b:2', name: 'Button/onClick', path: 'entry', startLine: 2, endLine: 4, source: true, testFiles: ['test/alpha.test.ts'] },
          ],
        },
      ],
    };
    const diff = (line: number) => `--- a/src/button.ts
+++ b/src/button.ts
@@ -${line},1 +${line},1 @@
-old
+new`;

    expect(narrowByExecutionFromView(view(handler), diff(4)).entered).toEqual(['test/alpha.test.ts', 'test/beta.test.ts']);
    expect(narrowByExecutionFromView(view(handler), diff(2)).entered).toEqual(['test/alpha.test.ts', 'test/beta.test.ts']);
    expect(narrowByExecutionFromView(view(handler), diff(3)).entered).toEqual(['test/alpha.test.ts']);
  });
});
