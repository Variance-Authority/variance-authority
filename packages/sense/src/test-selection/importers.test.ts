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
      readings: [],
      because: [
        { test: 'test/alpha.test.ts', via: [{ kind: 'importer', trail: ['src/rules.css', 'src/decide.ts'] }] },
        { test: 'test/beta.test.ts', via: [{ kind: 'importer', trail: ['src/rules.css', 'src/decide.ts'] }] },
      ],
    });
  });

  it('selects the tests behind the measured importer of an asset, whatever the importer beside it', () => {
    // Two files carry `src/tokens.css`. `src/decide.ts` has a row and its
    // tests are found; `src/legacy-widget.js` has none, and a test imports it.
    // Each importer answers for itself: decide's row names alpha and beta, and
    // legacy-widget names nobody, which neither removes them nor reports the
    // stylesheet.
    const relations = relationsOf({
      relations: [
        imports('test/aaa.test.ts', 'src/legacy-widget.js'),
        asset('src/legacy-widget.js', 'src/tokens.css'),
        asset('src/decide.ts', 'src/tokens.css'),
      ],
    });
    const measuredAlone = narrowByExecutionFromView(view(), diff('src/tokens.css'), {
      relations: relationsOf({ relations: [asset('src/decide.ts', 'src/tokens.css')] }),
    });

    expect(narrowByExecutionFromView(view(), diff('src/tokens.css'), { relations })).toEqual({
      whole: testFiles,
      entered: ['test/alpha.test.ts', 'test/beta.test.ts'],
      unread: [],
      stale: [],
      readings: [],
      because: [
        { test: 'test/alpha.test.ts', via: [{ kind: 'importer', trail: ['src/tokens.css', 'src/decide.ts'] }] },
        { test: 'test/beta.test.ts', via: [{ kind: 'importer', trail: ['src/tokens.css', 'src/decide.ts'] }] },
      ],
    });
    expect(narrowByExecutionFromView(view(), diff('src/tokens.css'), { relations })).toEqual(measuredAlone);
  });

  it('follows a `/// <depends>` edge from an asset as far as it follows an import', () => {
    // `src/rules.json` is imported by a module no test measured, and
    // `src/decide.ts` declares it reads the file. The declaration is the
    // chain that ends at a row.
    const relations = relationsOf({
      relations: [
        asset('src/legacy-widget.js', 'src/rules.json'),
        { from: file('src/decide.ts'), to: file('src/rules.json'), kind: 'depends' },
      ],
    });

    expect(narrowByExecutionFromView(view(), diff('src/rules.json'), { relations }).because).toEqual([
      { test: 'test/alpha.test.ts', via: [{ kind: 'importer', trail: ['src/rules.json', 'src/decide.ts'] }] },
      { test: 'test/beta.test.ts', via: [{ kind: 'importer', trail: ['src/rules.json', 'src/decide.ts'] }] },
    ]);
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
    // The same row with no test holding it: nobody loaded it that the record
    // can name, so it selects nobody, and the stylesheet is not reported.
    const unheld: TestCoverage = { ...unparsed, tests: coverage.tests };
    expect(
      narrowByExecutionFromView(openTestCoverage(encodeTestCoverage(unheld)), diff('src/rules.css'), { relations }),
    ).toMatchObject({ entered: [], unread: [], because: [] });
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

  it('adds nothing for a module whose edges could not be read, when the change is an asset', () => {
    // decide has a computed require the scan could not follow. The graph holds
    // no edge from it, so it is no chain and nothing is added for it: the one
    // chain the graph does hold ends at `src/other.ts`, which the record never
    // saw and which selects nobody. What the require loads is the recorded
    // run's to see, and the reason stays on decide's record for a report.
    const relations = relationsOf({
      relations: [asset('src/other.ts', 'src/rules.css')],
      unknown: [[file('src/decide.ts'), 'a computed require()']],
    });

    expect(narrowByExecutionFromView(view(), diff('src/rules.css'), { relations })).toMatchObject({
      entered: [],
      unread: [],
      because: [],
    });
  });

  it('answers a stylesheet from the edges the scan read, and none it could not', () => {
    // `src/legacy.css` has a `@use` the reader could not resolve, so it is
    // `unknown`, and on disk it may import the changed `src/rules.css`. The
    // graph has no such edge and the walk takes none: the change is answered by
    // decide's chain, which the record measured, and `test/aaa.test.ts` behind
    // the unreadable stylesheet is not selected through it.
    const relations = relationsOf({
      relations: [asset('src/decide.ts', 'src/rules.css'), asset('test/aaa.test.ts', 'src/legacy.css')],
      unknown: [[file('src/legacy.css'), 'a @use the reader could not resolve']],
    });

    expect(narrowByExecutionFromView(view(), diff('src/rules.css'), { relations })).toEqual({
      whole: testFiles,
      entered: ['test/alpha.test.ts', 'test/beta.test.ts'],
      unread: [],
      stale: [],
      readings: [],
      because: [
        { test: 'test/alpha.test.ts', via: [{ kind: 'importer', trail: ['src/rules.css', 'src/decide.ts'] }] },
        { test: 'test/beta.test.ts', via: [{ kind: 'importer', trail: ['src/rules.css', 'src/decide.ts'] }] },
      ],
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

  it('leaves a changed path the graph does not hold under unread', () => {
    // A README, or a source file outside the directories the scan was pointed
    // at. Nothing recorded it, and saying so is the whole point.
    const relations = relationsOf({ relations: [asset('src/decide.ts', 'src/rules.css')] });

    expect(narrowByExecutionFromView(view(), diff('README.md'), { relations })).toMatchObject({
      entered: [],
      unread: ['README.md'],
    });
  });

  it('selects nobody for an asset whose only importer was never recorded', () => {
    // `src/between.ts` imports the stylesheet and has no row, so no test the
    // record names ran it. A fixture the tests read with `fs` looks the same
    // from here, and a suite that reads one that way declares it as a
    // precondition; nothing did.
    const relations = relationsOf({ relations: [asset('src/between.ts', 'src/rules.css')] });

    expect(narrowByExecutionFromView(view(), diff('src/rules.css'), { relations })).toMatchObject({
      entered: [],
      unread: [],
    });
  });

  it('reports an asset the graph does not hold, and not one it holds that nothing imports', () => {
    // The first graph has no node for `src/rules.css` at all. The second holds
    // it, importing a stylesheet of its own, and no edge arrives at it: no
    // chain, so nobody selected, and nothing to report.
    const relations = relationsOf({ relations: [asset('src/decide.ts', 'src/other.css')] });

    expect(narrowByExecutionFromView(view(), diff('src/rules.css'), { relations })).toMatchObject({
      entered: [],
      unread: ['src/rules.css'],
    });
    expect(
      narrowByExecutionFromView(view(), diff('src/rules.css'), {
        relations: relationsOf({ relations: [asset('src/rules.css', 'src/tokens.css')] }),
      }),
    ).toMatchObject({ entered: [], unread: [] });
  });
});

describe('a package the install moved, asked of the files that import it', () => {
  const file = (name: string) => ({ kind: 'file', name }) as const;
  const pkg = (name: string) => ({ kind: 'package', name }) as const;
  const view = () => openTestCoverage(encodeTestCoverage(coverage));
  const uses = (from: string, to: string, kind: 'imports' | 'type' = 'imports') =>
    ({ from: file(from), to: pkg(to), kind }) as const;
  const beneath = (from: string, to: string) =>
    ({ from: pkg(from), to: pkg(to), kind: 'depends-on' }) as const;

  it('selects the tests that entered a module importing it', () => {
    const relations = relationsOf({ relations: [uses('src/decide.ts', '@mui/material')] });

    expect(narrowByExecutionFromView(view(), '', { relations, packages: ['@mui/material'] })).toEqual({
      whole: testFiles,
      entered: ['test/alpha.test.ts', 'test/beta.test.ts'],
      unread: [],
      stale: [],
      readings: [],
      because: [
        { test: 'test/alpha.test.ts', via: [{ kind: 'importer', trail: ['@mui/material', 'src/decide.ts'] }] },
        { test: 'test/beta.test.ts', via: [{ kind: 'importer', trail: ['@mui/material', 'src/decide.ts'] }] },
      ],
    });
  });

  it('reaches the importer from a package three levels under it', () => {
    // Nothing imports `jsdom`. `jest-environment-jsdom` resolves it beneath
    // itself, and `src/decide.ts` imports that: the bump arrives by the same
    // backwards walk an edited file arrives by, and the trail says so.
    const relations = relationsOf({
      relations: [uses('src/decide.ts', 'jest-environment-jsdom'), beneath('jest-environment-jsdom', 'jsdom')],
    });
    const narrowing = narrowByExecutionFromView(view(), '', { relations, packages: ['jsdom'] });

    expect(narrowing.entered).toEqual(['test/alpha.test.ts', 'test/beta.test.ts']);
    expect(narrowing.because[0]?.via).toEqual([
      { kind: 'importer', trail: ['jsdom', 'jest-environment-jsdom', 'src/decide.ts'] },
    ]);
  });

  it('says nothing about a package no file imports', () => {
    // An answer, not a gap: the install moved something this repository does
    // not reach, so nothing it does can be observed here.
    const relations = relationsOf({ relations: [uses('src/decide.ts', '@mui/material')] });

    expect(narrowByExecutionFromView(view(), '', { relations, packages: ['left-pad'] })).toEqual({
      whole: testFiles,
      entered: [],
      unread: [],
      stale: [],
      readings: [],
      because: [],
    });
  });

  it('does not select on a type-only import, which is erased before anything runs', () => {
    const relations = relationsOf({ relations: [uses('src/decide.ts', '@mui/material', 'type')] });

    expect(narrowByExecutionFromView(view(), '', { relations, packages: ['@mui/material'] }).entered).toEqual(
      [],
    );
  });

  it('selects nobody for a package whose every importer the record never measured', () => {
    // Nothing the suite ran imports it, which is the same answer as nothing
    // importing it at all.
    const relations = relationsOf({ relations: [uses('src/legacy-widget.js', '@mui/material')] });

    expect(narrowByExecutionFromView(view(), '', { relations, packages: ['@mui/material'] })).toEqual({
      whole: testFiles,
      entered: [],
      unread: [],
      stale: [],
      readings: [],
      because: [],
    });
  });

  it('selects the tests behind a measured importer, whatever the importer beside it', () => {
    const relations = relationsOf({
      relations: [uses('src/legacy-widget.js', '@mui/material'), uses('src/decide.ts', '@mui/material')],
    });

    expect(narrowByExecutionFromView(view(), '', { relations, packages: ['@mui/material'] })).toMatchObject({
      entered: ['test/alpha.test.ts', 'test/beta.test.ts'],
      unread: [],
      because: [
        { test: 'test/alpha.test.ts', via: [{ kind: 'importer', trail: ['@mui/material', 'src/decide.ts'] }] },
        { test: 'test/beta.test.ts', via: [{ kind: 'importer', trail: ['@mui/material', 'src/decide.ts'] }] },
      ],
    });
  });
});
