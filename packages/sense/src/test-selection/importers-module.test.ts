import { relationsOf } from '@variance-authority/core/relate';
import { describe, expect, it } from 'vitest';
import { encodeTestCoverage } from './format.js';
import { openTestCoverage } from './format-view.js';
import type { TestCoverage } from './index.js';
import { narrowByExecutionFromView } from './select.js';
import { coverage, testFiles } from './__fixtures__/coverage.js';

describe('a changed module with no row, asked of the files that import it', () => {
  const file = (name: string) => ({ kind: 'file', name }) as const;
  const view = () => openTestCoverage(encodeTestCoverage(coverage));
  const diff = (path: string) => `--- a/${path}
+++ b/${path}
@@ -1,1 +1,1 @@
-old
+new`;
  const imports = (from: string, to: string, kind: 'imports' | 'type' = 'imports') =>
    ({ from: file(from), to: file(to), kind }) as const;

  it('selects a test that imports the module itself, and does not report the module', () => {
    // `src/rules.ts` has no row: the recording did not instrument it, or it is
    // new since. aaa imports it, so aaa ran it.
    const relations = relationsOf({ relations: [imports('test/aaa.test.ts', 'src/rules.ts')] });

    expect(narrowByExecutionFromView(view(), diff('src/rules.ts'), { relations })).toEqual({
      whole: testFiles,
      entered: ['test/aaa.test.ts'],
      unread: [],
      stale: [],
      readings: [],
      because: [
        { test: 'test/aaa.test.ts', via: [{ kind: 'importer', trail: ['src/rules.ts', 'test/aaa.test.ts'] }] },
      ],
    });
  });

  it('selects the tests of the nearest recorded importer, and looks no further', () => {
    // rules ← between ← decide ← aaa. between has no row and is walked past;
    // decide has one, and every test that loaded rules through it crossed its
    // module block, so the row is the answer for everything behind it. aaa
    // imports decide and never entered it — it mocked it — and the walk does
    // not ask. The chain through `src/other.ts` reaches nothing recorded and
    // takes nothing from the one beside it.
    const relations = relationsOf({
      relations: [
        imports('src/between.ts', 'src/rules.ts'),
        imports('src/decide.ts', 'src/between.ts'),
        imports('test/aaa.test.ts', 'src/decide.ts'),
        imports('src/other.ts', 'src/rules.ts'),
      ],
    });
    const trail = ['src/rules.ts', 'src/between.ts', 'src/decide.ts'];

    expect(narrowByExecutionFromView(view(), diff('src/rules.ts'), { relations })).toEqual({
      whole: testFiles,
      entered: ['test/alpha.test.ts', 'test/beta.test.ts'],
      unread: [],
      stale: [],
      readings: [],
      because: [
        { test: 'test/alpha.test.ts', via: [{ kind: 'importer', trail }] },
        { test: 'test/beta.test.ts', via: [{ kind: 'importer', trail }] },
      ],
    });
  });

  it('selects nothing for a module whose every chain ends where nothing was recorded', () => {
    // `src/other.ts` imports rules, has no row, and nothing imports it. Without
    // a graph the file is a path nothing holds, and reported; with one it is
    // held, and no chain reaches a row.
    const relations = relationsOf({ relations: [imports('src/other.ts', 'src/rules.ts')] });
    const without = narrowByExecutionFromView(view(), diff('src/rules.ts'), {});

    expect(without).toMatchObject({ entered: [], unread: ['src/rules.ts'], because: [] });
    expect(narrowByExecutionFromView(view(), diff('src/rules.ts'), { relations })).toEqual({ ...without, unread: [] });
  });

  it('does not walk a type-only import, which is erased before anything runs', () => {
    const erased = relationsOf({ relations: [imports('src/decide.ts', 'src/rules.ts', 'type')] });
    const loaded = relationsOf({ relations: [imports('src/decide.ts', 'src/rules.ts')] });

    expect(narrowByExecutionFromView(view(), diff('src/rules.ts'), { relations: erased })).toMatchObject({
      entered: [],
      unread: [],
    });
    expect(narrowByExecutionFromView(view(), diff('src/rules.ts'), { relations: loaded }).entered).toEqual([
      'test/alpha.test.ts',
      'test/beta.test.ts',
    ]);
  });

  it('looks each importer up under every name the snapshot holds it by', () => {
    // The graph knows `src`; the record holds decide under its built twin,
    // which is what every other package's tests loaded.
    const built: TestCoverage = {
      ...coverage,
      modules: coverage.modules.map((module) =>
        module.file === 'src/decide.ts' ? { ...module, file: 'dist/decide.js' } : module,
      ),
    };
    const knownAs = (name: string): readonly string[] =>
      name.startsWith('src/') ? [name, name.replace(/^src\/(.*)\.ts$/, 'dist/$1.js')] : [name];
    const relations = relationsOf({
      relations: [imports('src/decide.ts', 'src/rules.ts'), imports('test/aaa.test.ts', 'src/decide.ts')],
    });
    const snapshot = openTestCoverage(encodeTestCoverage(built));

    expect(narrowByExecutionFromView(snapshot, diff('src/rules.ts'), { relations, knownAs })).toMatchObject({
      entered: ['test/alpha.test.ts', 'test/beta.test.ts'],
      unread: [],
      because: [
        { test: 'test/alpha.test.ts', via: [{ kind: 'importer', trail: ['src/rules.ts', 'src/decide.ts'] }] },
        { test: 'test/beta.test.ts', via: [{ kind: 'importer', trail: ['src/rules.ts', 'src/decide.ts'] }] },
      ],
    });
    // A changed file whose twin has the row is the row's, and the graph adds
    // nothing: aaa imports decide and is not asked.
    const branch = `--- a/src/decide.ts
+++ b/src/decide.ts
@@ -4,1 +4,1 @@
-    return 'A';
+    return 'a';`;
    expect(narrowByExecutionFromView(snapshot, branch, { relations, knownAs })).toMatchObject({
      entered: ['test/alpha.test.ts'],
      because: [
        {
          test: 'test/alpha.test.ts',
          via: [{ kind: 'region', file: 'dist/decide.js', name: 'decide', path: 'if#0/then', startLine: 3, endLine: 5 }],
        },
      ],
    });
  });

  it('cuts a test that mocked the changed module, or the file it loaded it through', () => {
    // Both alpha and beta entered decide. alpha replaced what decide loads, so
    // it never ran rules, whatever it crossed in decide's row (`shadowed.ts`).
    const direct = relationsOf({
      relations: [imports('src/decide.ts', 'src/rules.ts')],
      shadows: new Map([['test/alpha.test.ts', ['src/rules.ts']]]),
    });
    const between = relationsOf({
      relations: [
        imports('src/between.ts', 'src/rules.ts'),
        imports('src/decide.ts', 'src/between.ts'),
        imports('test/alpha.test.ts', 'src/decide.ts'),
      ],
      shadows: new Map([['test/alpha.test.ts', ['src/between.ts']]]),
    });

    expect(narrowByExecutionFromView(view(), diff('src/rules.ts'), { relations: direct }).entered).toEqual([
      'test/beta.test.ts',
    ]);
    expect(narrowByExecutionFromView(view(), diff('src/rules.ts'), { relations: between }).entered).toEqual([
      'test/beta.test.ts',
    ]);
  });

  it('walks past an importer the build could not instrument, and asks the table for its tests', () => {
    // legacy's row has no probes behind it, so it measured nothing and the
    // chain goes on to decide. aaa holds legacy as a precondition, which is how
    // an uninstrumented module names the tests that loaded it.
    const unparsed: TestCoverage = {
      ...coverage,
      tests: coverage.tests.map((test) =>
        test.file === 'test/aaa.test.ts'
          ? { ...test, preconditions: [...test.preconditions, { name: 'src/legacy.js', digest: 'source:legacy' }] }
          : test,
      ),
      modules: [
        ...coverage.modules,
        { file: 'src/legacy.js', sourceDigest: 'source:legacy', instrumented: false, blocks: [] },
      ],
    };
    const relations = relationsOf({
      relations: [imports('src/legacy.js', 'src/rules.ts'), imports('src/decide.ts', 'src/legacy.js')],
    });
    const trail = ['src/rules.ts', 'src/legacy.js', 'src/decide.ts'];

    expect(
      narrowByExecutionFromView(openTestCoverage(encodeTestCoverage(unparsed)), diff('src/rules.ts'), { relations }),
    ).toMatchObject({
      entered: testFiles,
      unread: [],
      because: [
        { test: 'test/aaa.test.ts', via: [{ kind: 'importer', trail: ['src/rules.ts', 'src/legacy.js'] }] },
        { test: 'test/alpha.test.ts', via: [{ kind: 'importer', trail }] },
        { test: 'test/beta.test.ts', via: [{ kind: 'importer', trail }] },
      ],
    });
  });

  it('selects a changed test file by its own precondition, and a test that imports it by the import', () => {
    // Nothing probes a test file, so aaa is selected by its own precondition.
    // beta imports it, which loads everything it declares.
    const relations = relationsOf({ relations: [imports('test/beta.test.ts', 'test/aaa.test.ts')] });

    expect(narrowByExecutionFromView(view(), diff('test/aaa.test.ts'), { relations })).toMatchObject({
      entered: ['test/aaa.test.ts', 'test/beta.test.ts'],
      unread: [],
      because: [
        { test: 'test/aaa.test.ts', via: [{ kind: 'precondition', name: 'test/aaa.test.ts' }] },
        {
          test: 'test/beta.test.ts',
          via: [{ kind: 'importer', trail: ['test/aaa.test.ts', 'test/beta.test.ts'] }],
        },
      ],
    });
  });

  it('does not answer for a changed module through a file whose edges could not be read', () => {
    // decide has a computed require the scan could not follow, and it may load
    // rules. The graph holds no such edge, so decide's tests are not the answer:
    // the one chain it holds ends at `src/other.ts`, which the record never saw.
    const relations = relationsOf({
      relations: [imports('src/other.ts', 'src/rules.ts')],
      unknown: [[file('src/decide.ts'), 'a computed require()']],
    });

    expect(narrowByExecutionFromView(view(), diff('src/rules.ts'), { relations })).toMatchObject({
      entered: [],
      unread: [],
    });
  });

  it('leaves a recorded module to its regions, whoever imports it without loading it', () => {
    // `src/decide.ts` has a row: alpha and beta entered it. `test/aaa.test.ts`
    // imports it and mocked it, so the journal holds nothing for aaa under
    // decide, and an edit to the `then` branch is alpha alone.
    const relations = relationsOf({ relations: [imports('test/aaa.test.ts', 'src/decide.ts')] });
    const diff = `--- a/src/decide.ts
+++ b/src/decide.ts
@@ -4,1 +4,1 @@
-    return 'A';
+    return 'a';`;

    expect(narrowByExecutionFromView(view(), diff, { relations })).toEqual({
      whole: testFiles,
      entered: ['test/alpha.test.ts'],
      unread: [],
      stale: [],
      // No `sourceAt`, so no old text to read the change against.
      readings: [{ file: 'src/decide.ts', unread: 'source' }],
      because: [
        {
          test: 'test/alpha.test.ts',
          via: [{ kind: 'region', file: 'src/decide.ts', name: 'decide', path: 'if#0/then', startLine: 3, endLine: 5 }],
        },
      ],
    });
  });
});
