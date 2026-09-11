import { relationsOf } from '@variance-authority/core/relate';
import { describe, expect, it } from 'vitest';
import { encodeTestCoverage, openTestCoverage } from './format.js';
import type { TestCoverage } from './index.js';
import { narrowByExecutionFromView } from './select.js';
import { coverage, testFiles } from './__fixtures__/coverage.js';

describe('a changed file no probe can sit in, asked of the module that imports it', () => {
  const file = (name: string) => ({ kind: 'file', name }) as const;
  const view = () => openTestCoverage(encodeTestCoverage(coverage));
  const diff = (path: string) => `--- a/${path}
+++ b/${path}
@@ -1,1 +1,1 @@
-old
+new`;
  const asset = (from: string, to: string) => ({ from: file(from), to: file(to), kind: 'asset' }) as const;
  const imports = (from: string, to: string) => ({ from: file(from), to: file(to), kind: 'imports' }) as const;

  it('selects the tests that entered the module importing a stylesheet', () => {
    // `src/rules.css` holds no probe and has no row. `src/decide.ts` imports it
    // and has a row; the tests that entered `decide` ran the stylesheet.
    const relations = relationsOf({ relations: [asset('src/decide.ts', 'src/rules.css')] });

    expect(narrowByExecutionFromView(view(), diff('src/rules.css'), { relations })).toEqual({
      whole: testFiles,
      entered: ['test/alpha.test.ts', 'test/beta.test.ts'],
      unread: [],
      because: [
        { test: 'test/alpha.test.ts', via: [{ kind: 'importer', trail: ['src/rules.css', 'src/decide.ts'] }] },
        { test: 'test/beta.test.ts', via: [{ kind: 'importer', trail: ['src/rules.css', 'src/decide.ts'] }] },
      ],
    });
  });

  it('answers a module nobody executed with nobody, whoever imports it', () => {
    // The `vi.mock` case: aaa names `src/rules.ts` and replaces it, decide
    // imports it and was mocked in the test that ran it. No row, no line run,
    // and the tests behind the mock are a dead branch.
    const relations = relationsOf({
      relations: [imports('test/aaa.test.ts', 'src/rules.ts'), imports('src/decide.ts', 'src/rules.ts')],
    });

    expect(narrowByExecutionFromView(view(), diff('src/rules.ts'), { relations })).toEqual({
      whole: testFiles,
      entered: [],
      unread: [],
      because: [],
    });
  });

  it('continues through a stylesheet that imports the changed one, and stops at the module', () => {
    // tokens.css ← button.css ← decide.ts ← (imports) between.ts. The walk
    // reaches decide through two asset edges and never looks at between,
    // which imports decide as a module and has no row of its own.
    const relations = relationsOf({
      relations: [
        asset('src/button.css', 'src/tokens.css'),
        asset('src/decide.ts', 'src/button.css'),
        imports('src/between.ts', 'src/decide.ts'),
      ],
    });

    expect(narrowByExecutionFromView(view(), diff('src/tokens.css'), { relations }).because).toEqual([
      {
        test: 'test/alpha.test.ts',
        via: [{ kind: 'importer', trail: ['src/tokens.css', 'src/button.css', 'src/decide.ts'] }],
      },
      {
        test: 'test/beta.test.ts',
        via: [{ kind: 'importer', trail: ['src/tokens.css', 'src/button.css', 'src/decide.ts'] }],
      },
    ]);
  });

  it('selects a test that imports the stylesheet itself', () => {
    const relations = relationsOf({ relations: [asset('test/aaa.test.ts', 'src/rules.css')] });

    expect(narrowByExecutionFromView(view(), diff('src/rules.css'), { relations })).toMatchObject({
      entered: ['test/aaa.test.ts'],
      because: [{ test: 'test/aaa.test.ts', via: [{ kind: 'importer', trail: ['src/rules.css', 'test/aaa.test.ts'] }] }],
    });
  });

  it('reaches the tests that loaded an importing module the build could not instrument', () => {
    // The row is there and empty: no blocks, so no crossings to read. The tests
    // that loaded it hold it as a precondition, and that is where they are found.
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
    const relations = relationsOf({ relations: [asset('src/legacy.js', 'src/rules.css')] });

    expect(
      narrowByExecutionFromView(openTestCoverage(encodeTestCoverage(unparsed)), diff('src/rules.css'), { relations }),
    ).toMatchObject({
      entered: ['test/aaa.test.ts'],
      unread: [],
      because: [{ test: 'test/aaa.test.ts', via: [{ kind: 'importer', trail: ['src/rules.css', 'src/legacy.js'] }] }],
    });
  });

  it('looks the importing module up under every name the snapshot holds it by', () => {
    // The graph knows `src`; the tests of every other package entered the built
    // twin, and that is the row that holds their crossings.
    const relations = relationsOf({ relations: [asset('lib/src/decide.ts', 'lib/src/rules.css')] });
    const knownAs = (name: string) => (name === 'lib/src/decide.ts' ? ['src/decide.ts'] : [name]);

    expect(
      narrowByExecutionFromView(view(), diff('lib/src/rules.css'), { relations, knownAs }).entered,
    ).toEqual(['test/alpha.test.ts', 'test/beta.test.ts']);
  });

  it('adds the tests of a module whose edges could not be read, when the change is an asset', () => {
    // decide has a computed require the scan could not follow. It may reach
    // the stylesheet, so its tests are selected beside what the walk found.
    const relations = relationsOf({
      relations: [asset('src/other.ts', 'src/rules.css')],
      unknown: [[file('src/decide.ts'), 'a computed require()']],
    });

    expect(narrowByExecutionFromView(view(), diff('src/rules.css'), { relations })).toMatchObject({
      entered: ['test/alpha.test.ts', 'test/beta.test.ts'],
      unread: [],
      because: [
        { test: 'test/alpha.test.ts', via: [{ kind: 'importer', trail: ['src/rules.css', 'src/decide.ts'] }] },
        { test: 'test/beta.test.ts', via: [{ kind: 'importer', trail: ['src/rules.css', 'src/decide.ts'] }] },
      ],
    });
  });

  it('does not revive a dead module through a file whose edges could not be read', () => {
    // Had decide's computed require loaded `src/rules.ts`, rules would have a row.
    const relations = relationsOf({
      relations: [imports('src/other.ts', 'src/rules.ts')],
      unknown: [[file('src/decide.ts'), 'a computed require()']],
    });

    expect(narrowByExecutionFromView(view(), diff('src/rules.ts'), { relations })).toMatchObject({
      entered: [],
      unread: [],
    });
  });

  it('answers each changed file on its own, so every trail starts at the file it explains', () => {
    const relations = relationsOf({
      relations: [asset('src/decide.ts', 'src/rules.css'), asset('src/decide.ts', 'src/limits.json')],
    });

    expect(
      narrowByExecutionFromView(view(), `${diff('src/rules.css')}\n${diff('src/limits.json')}`, { relations }).because,
    ).toEqual([
      {
        test: 'test/alpha.test.ts',
        via: [
          { kind: 'importer', trail: ['src/limits.json', 'src/decide.ts'] },
          { kind: 'importer', trail: ['src/rules.css', 'src/decide.ts'] },
        ],
      },
      {
        test: 'test/beta.test.ts',
        via: [
          { kind: 'importer', trail: ['src/limits.json', 'src/decide.ts'] },
          { kind: 'importer', trail: ['src/rules.css', 'src/decide.ts'] },
        ],
      },
    ]);
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
      because: [
        {
          test: 'test/alpha.test.ts',
          via: [{ kind: 'region', file: 'src/decide.ts', name: 'decide', path: 'if#0/then', startLine: 3, endLine: 5 }],
        },
      ],
    });
  });

  it('selects a changed test file by its own precondition and nobody through its helpers', () => {
    // Nothing probes a test file, so an edit to `test/aaa.test.ts` selects aaa
    // by its own precondition. beta imports aaa's helpers as a module, and a
    // module with no row selects nobody.
    const relations = relationsOf({ relations: [imports('test/beta.test.ts', 'test/aaa.test.ts')] });

    expect(narrowByExecutionFromView(view(), diff('test/aaa.test.ts'), { relations })).toMatchObject({
      entered: ['test/aaa.test.ts'],
      unread: [],
      because: [{ test: 'test/aaa.test.ts', via: [{ kind: 'precondition', name: 'test/aaa.test.ts' }] }],
    });
  });

  it('leaves a changed path the graph does not hold under unread', () => {
    // A README, or a source file outside the directories the scan was pointed
    // at. Nothing recorded it, and saying so is the whole point.
    const relations = relationsOf({ relations: [asset('src/decide.ts', 'src/rules.css')] });

    expect(narrowByExecutionFromView(view(), diff('README.md'), { relations })).toMatchObject({
      entered: [],
      unread: ['README.md'],
    });
  });

  it('answers an asset no import carries to a recorded test with nobody', () => {
    // A fixture the tests read with `fs` has no importers and still has tests;
    // a suite that reads one that way declares it as a precondition.
    const relations = relationsOf({ relations: [asset('src/between.ts', 'src/rules.css')] });

    expect(narrowByExecutionFromView(view(), diff('src/rules.css'), { relations })).toMatchObject({
      entered: [],
      unread: [],
    });
  });
});
