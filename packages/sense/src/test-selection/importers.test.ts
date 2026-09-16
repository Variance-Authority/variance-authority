import { relationsOf } from '@variance-authority/core/relate';
import { describe, expect, it } from 'vitest';
import { encodeTestCoverage } from './format.js';
import { openTestCoverage } from './format-view.js';
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
      stale: [],
      because: [
        { test: 'test/alpha.test.ts', via: [{ kind: 'importer', trail: ['src/rules.css', 'src/decide.ts'] }] },
        { test: 'test/beta.test.ts', via: [{ kind: 'importer', trail: ['src/rules.css', 'src/decide.ts'] }] },
      ],
    });
  });

  it('leaves a module nobody executed unread, however many files import it', () => {
    // aaa names `src/rules.ts` and decide imports it, and the record has no row
    // for it. Maybe every test mocked it, maybe it sits outside what the
    // recording instrumented, maybe it is new since the recording: the record
    // cannot say which, and `imports` edges are not walked, so the graph
    // cannot either. Nobody answered, and nobody is not an answer.
    const relations = relationsOf({
      relations: [imports('test/aaa.test.ts', 'src/rules.ts'), imports('src/decide.ts', 'src/rules.ts')],
    });

    expect(narrowByExecutionFromView(view(), diff('src/rules.ts'), { relations })).toEqual({
      whole: testFiles,
      entered: [],
      unread: ['src/rules.ts'],
      stale: [],
      because: [],
    });
  });

  it('answers the same as no graph at all when the graph answers nothing', () => {
    // The graph is an enrichment. It may add a selection; it may never turn a
    // question the record left open into a closed one by holding the file.
    const relations = relationsOf({
      relations: [imports('test/aaa.test.ts', 'src/rules.ts'), imports('src/decide.ts', 'src/rules.ts')],
    });
    const without = narrowByExecutionFromView(view(), diff('src/rules.ts'), {});

    expect(without.unread).toEqual(['src/rules.ts']);
    expect(narrowByExecutionFromView(view(), diff('src/rules.ts'), { relations })).toEqual(without);
  });

  it('leaves a changed asset unread when one chain from it ends where the record never looked', () => {
    // Two files carry `src/tokens.css`. `src/decide.ts` has a row and its
    // tests are found; `src/legacy-widget.js` has none, and a test imports it.
    // One measured importer says nothing about the importer beside it: the
    // tests behind legacy-widget ran the stylesheet too, and the record cannot
    // name them.
    const relations = relationsOf({
      relations: [
        imports('test/aaa.test.ts', 'src/legacy-widget.js'),
        asset('src/legacy-widget.js', 'src/tokens.css'),
        asset('src/decide.ts', 'src/tokens.css'),
      ],
    });

    expect(narrowByExecutionFromView(view(), diff('src/tokens.css'), { relations })).toMatchObject({
      entered: ['test/alpha.test.ts', 'test/beta.test.ts'],
      unread: ['src/tokens.css'],
    });
    // The measured chain alone is the whole answer.
    expect(
      narrowByExecutionFromView(view(), diff('src/tokens.css'), {
        relations: relationsOf({ relations: [asset('src/decide.ts', 'src/tokens.css')] }),
      }),
    ).toMatchObject({ entered: ['test/alpha.test.ts', 'test/beta.test.ts'], unread: [] });
  });

  it('counts a row with probes and no crossings as measured: nobody entered it', () => {
    // An instrumented module nobody ran is an answer — the build carried
    // probes into it and no test crossed them — where a module with no row
    // is a question.
    const idle: TestCoverage = {
      ...coverage,
      modules: [
        ...coverage.modules,
        {
          file: 'src/idle.ts',
          sourceDigest: 'source:idle',
          instrumented: true,
          blocks: [{ ordinal: 0, kind: 'module', digest: 'block:idle', name: '', path: 'module', startLine: 1, endLine: 3, source: true, testFiles: [] }],
        },
      ],
    };
    const relations = relationsOf({ relations: [asset('src/idle.ts', 'src/rules.css')] });

    expect(
      narrowByExecutionFromView(openTestCoverage(encodeTestCoverage(idle)), diff('src/rules.css'), { relations }),
    ).toMatchObject({ entered: [], unread: [] });
  });

  it('selects the tests of every row recorded under one importing module', () => {
    // Two builds read `src/twice.ts` — say a second environment — and each
    // row holds its own crossings. A lookup that lands on one of them leaves
    // the other's tests on the floor.
    const twice: TestCoverage = {
      ...coverage,
      modules: [
        ...coverage.modules,
        {
          file: 'src/twice.ts',
          sourceDigest: 'source:twice',
          instrumented: true,
          blocks: [{ ordinal: 0, kind: 'module', digest: 'block:twice', name: '', path: 'module', startLine: 1, endLine: 3, source: true, testFiles: ['test/aaa.test.ts'] }],
        },
        {
          file: 'src/twice.ts',
          sourceDigest: 'source:twice',
          instrumented: true,
          blocks: [{ ordinal: 0, kind: 'module', digest: 'block:twice', name: '', path: 'module', startLine: 1, endLine: 3, source: true, testFiles: ['test/beta.test.ts'] }],
        },
      ],
    };
    const relations = relationsOf({ relations: [asset('src/twice.ts', 'src/rules.css')] });

    expect(
      narrowByExecutionFromView(openTestCoverage(encodeTestCoverage(twice)), diff('src/rules.css'), { relations }),
    ).toMatchObject({ entered: ['test/aaa.test.ts', 'test/beta.test.ts'], unread: [] });
    // A test both rows hold is reached once, by the one walk that reached it.
    const both: TestCoverage = {
      ...twice,
      modules: twice.modules.map((module) =>
        module.file === 'src/twice.ts'
          ? { ...module, blocks: module.blocks.map((block) => ({ ...block, testFiles: ['test/aaa.test.ts'] })) }
          : module,
      ),
    };
    expect(
      narrowByExecutionFromView(openTestCoverage(encodeTestCoverage(both)), diff('src/rules.css'), { relations }).because,
    ).toEqual([{ test: 'test/aaa.test.ts', via: [{ kind: 'importer', trail: ['src/rules.css', 'src/twice.ts'] }] }]);
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
    // the stylesheet, so its tests are selected beside what the walk found —
    // and only added: the graph holds no edge from it, so it is no chain, and
    // the one chain the graph does hold ends at `src/other.ts`, which the
    // record never saw. Nobody answered for that chain.
    const relations = relationsOf({
      relations: [asset('src/other.ts', 'src/rules.css')],
      unknown: [[file('src/decide.ts'), 'a computed require()']],
    });

    expect(narrowByExecutionFromView(view(), diff('src/rules.css'), { relations })).toMatchObject({
      entered: ['test/alpha.test.ts', 'test/beta.test.ts'],
      unread: ['src/rules.css'],
      because: [
        { test: 'test/alpha.test.ts', via: [{ kind: 'importer', trail: ['src/rules.css', 'src/decide.ts'] }] },
        { test: 'test/beta.test.ts', via: [{ kind: 'importer', trail: ['src/rules.css', 'src/decide.ts'] }] },
      ],
    });
  });

  it('adds the tests behind a stylesheet whose own edges could not be read', () => {
    // The record holds one row here, `src/decide.ts`, and it never held more:
    // a stylesheet can hold no probe, so `src/legacy.css` has no row and never
    // will. The scan could not enumerate its imports either — a `@use` against
    // a sass partial resolves to nothing, and a file with a hole is `unknown` —
    // and on disk it imports the changed `src/rules.css`, which `test/aaa.test.ts`
    // renders through. Answering the change from decide's chain alone and
    // calling it settled empties `unread`, and an empty `unread` is the
    // caller's licence to skip everything outside `entered`: aaa, which renders
    // the changed stylesheet, would not run. Asking the unreadable file itself
    // for a row cannot catch this, because the files it stands for are exactly
    // the kind that have none. The edge nobody saw is walked as though it were
    // in the graph instead, and the tests on the far side of it are added.
    const relations = relationsOf({
      relations: [asset('src/decide.ts', 'src/rules.css'), asset('test/aaa.test.ts', 'src/legacy.css')],
      unknown: [[file('src/legacy.css'), 'a @use the reader could not resolve']],
    });

    expect(narrowByExecutionFromView(view(), diff('src/rules.css'), { relations })).toEqual({
      whole: testFiles,
      entered: ['test/aaa.test.ts', 'test/alpha.test.ts', 'test/beta.test.ts'],
      unread: [],
      stale: [],
      because: [
        {
          test: 'test/aaa.test.ts',
          via: [{ kind: 'importer', trail: ['src/rules.css', 'src/legacy.css', 'test/aaa.test.ts'] }],
        },
        { test: 'test/alpha.test.ts', via: [{ kind: 'importer', trail: ['src/rules.css', 'src/decide.ts'] }] },
        { test: 'test/beta.test.ts', via: [{ kind: 'importer', trail: ['src/rules.css', 'src/decide.ts'] }] },
      ],
    });
  });

  it('leaves a changed asset unread when the unreadable file leads only where the record never looked', () => {
    // The same unreadable stylesheet, carried this time by `src/between.ts`,
    // which the record has no row for. The edge nobody saw may still be there,
    // and now nothing on the far side of it can name a test. The chain decide
    // answered says nothing about this one, so the question the graph raised is
    // one nothing answered.
    const relations = relationsOf({
      relations: [asset('src/decide.ts', 'src/rules.css'), asset('src/between.ts', 'src/legacy.css')],
      unknown: [[file('src/legacy.css'), 'a @use the reader could not resolve']],
    });

    expect(narrowByExecutionFromView(view(), diff('src/rules.css'), { relations })).toMatchObject({
      entered: ['test/alpha.test.ts', 'test/beta.test.ts'],
      unread: ['src/rules.css'],
    });
  });

  it('does not answer for a changed module through a file whose edges could not be read', () => {
    // A file with unreadable edges is consulted only for a changed asset. A
    // changed module answers by its row, and `src/rules.ts` has none: the
    // question stays open, and decide's tests are not the answer to it.
    const relations = relationsOf({
      relations: [imports('src/other.ts', 'src/rules.ts')],
      unknown: [[file('src/decide.ts'), 'a computed require()']],
    });

    expect(narrowByExecutionFromView(view(), diff('src/rules.ts'), { relations })).toMatchObject({
      entered: [],
      unread: ['src/rules.ts'],
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
      stale: [],
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

  it('leaves an asset unread when the only file carrying it was never recorded', () => {
    // `src/between.ts` imports the stylesheet and has no row. A fixture the
    // tests read with `fs` looks the same from here, and a suite that reads
    // one that way declares it as a precondition; nothing did, so nobody
    // answered.
    const relations = relationsOf({ relations: [asset('src/between.ts', 'src/rules.css')] });

    expect(narrowByExecutionFromView(view(), diff('src/rules.css'), { relations })).toMatchObject({
      entered: [],
      unread: ['src/rules.css'],
    });
  });

  it('leaves an asset the graph holds and nothing imports unread', () => {
    // The graph has the file and no edge leaves it: no chain, no end, no
    // answer. Holding a file is not the same as having measured it.
    const relations = relationsOf({ relations: [asset('src/decide.ts', 'src/other.css')] });

    expect(narrowByExecutionFromView(view(), diff('src/rules.css'), { relations })).toMatchObject({
      entered: [],
      unread: ['src/rules.css'],
    });
    expect(
      narrowByExecutionFromView(view(), diff('src/rules.css'), {
        relations: relationsOf({ relations: [asset('src/rules.css', 'src/tokens.css')] }),
      }),
    ).toMatchObject({ entered: [], unread: ['src/rules.css'] });
  });
});
