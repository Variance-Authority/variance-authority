import { relationsOfFiles } from '@variance-authority/core/relate';
import { describe, expect, it } from 'vitest';
import { reachOf, regionRecord } from './range-state.js';
import { coveringChange, coveringTests, coveringTestsInFile, ranWhileLoading, stoppedBefore, type CoveringRegion, type ExecutionIndex } from './reverse.js';

/**
 * A region's reach is one reading of its record, so the whole-file answer, a
 * changed region's answer and the review handover built on it cannot tell the
 * same region two ways.
 */
const tests = [
  { id: 'guest', file: 'test/cart.test.ts', name: 'guest', stopped: false },
  { id: 'mocked', file: 'test/mocked.test.ts', name: 'mocked', stopped: false },
];
const file = 'src/cart/total.ts';

function both(index: ExecutionIndex, line: number, relations?: ReturnType<typeof relationsOfFiles>) {
  const options = relations === undefined ? {} : { relations };
  const range = coveringTestsInFile(index, file, options).find((one) => one.startLine <= line && line <= one.endLine);
  const region: CoveringRegion | undefined = coveringChange(index, new Map([[file, [{ start: line, end: line }]]]), options)[0]?.regions[0];
  const target = { file, line };
  const stopped = stoppedBefore(index, target, options);
  const asked = reachOf({
    tests: coveringTests(index, target, options),
    ...(ranWhileLoading(index, target, options) ? { loaded: true as const } : {}),
    ...(stopped === undefined ? {} : { stopped }),
  });
  return {
    file: range === undefined ? undefined : reachOf(range),
    change: region === undefined ? undefined : reachOf(regionRecord(region)),
    target: asked,
  };
}

describe('the reach of a region', () => {
  it('is loaded on both answers when it ran while its module evaluated and no graph names who loaded it', () => {
    const index: ExecutionIndex = {
      tests,
      modules: [{ file, blocks: [
        { kind: 'statement', name: 'RATE', path: 'statement#0', startLine: 1, endLine: 1, source: true, loaded: true, crossings: [] },
      ] }],
    };

    expect(both(index, 1)).toEqual({ file: 'loaded', change: 'loaded', target: 'loaded' });
  });

  it('is loaded on both answers when the producer wrote load time on the crossing', () => {
    const index: ExecutionIndex = {
      tests,
      modules: [{ file, blocks: [
        { kind: 'statement', name: 'RATE', path: 'statement#0', startLine: 1, endLine: 1, source: true, crossings: [{ test: 0, distance: 0, loaded: true }] },
      ] }],
    };

    expect(both(index, 1)).toEqual({ file: 'loaded', change: 'loaded', target: 'loaded' });
  });

  it('is unentered on both answers when the only crossing is a mock evaluating the real module', () => {
    // `mocked.test.ts` mocks `total.ts`; the runner evaluated the real module to
    // shape the automock, and that evaluation is the block's only crossing.
    const index: ExecutionIndex = {
      tests,
      modules: [{ file, blocks: [
        { kind: 'function', name: 'priceOf', path: 'entry', startLine: 3, endLine: 9, source: true, crossings: [{ test: 1, distance: 0, loaded: true }] },
      ] }],
    };
    const relations = relationsOfFiles(
      [{ file }, ...tests.map((test) => ({ file: test.file, edges: [{ to: file, kind: 'imports' as const }] }))],
      { shadows: new Map([['test/mocked.test.ts', [file]]]) },
    );

    expect(both(index, 4, relations)).toEqual({ file: 'unwalked', change: 'unwalked', target: 'unwalked' });
  });

  it('is unwalked, not a hole, when the case that stopped only reached it through its own mock', () => {
    const stoppedTests = [tests[0]!, { ...tests[1]!, stopped: true }];
    const index: ExecutionIndex = {
      tests: stoppedTests,
      modules: [{ file, blocks: [
        { kind: 'function', name: 'priceOf', path: 'entry', startLine: 3, endLine: 9, source: true, crossings: [{ test: 1, distance: 0, loaded: true }] },
      ] }],
    };
    const relations = relationsOfFiles(
      [{ file }, ...tests.map((test) => ({ file: test.file, edges: [{ to: file, kind: 'imports' as const }] }))],
      { shadows: new Map([['test/mocked.test.ts', [file]]]) },
    );

    expect(both(index, 4, relations)).toEqual({ file: 'unwalked', change: 'unwalked', target: 'unwalked' });
  });

  it('is unentered on both answers when the module ran at load only because its one importer mocks it', () => {
    // The producer writes load time on the block, not the crossing: the graph
    // says who loaded it, and the one file that imports it replaced it.
    const index: ExecutionIndex = {
      tests,
      modules: [{ file, blocks: [
        { kind: 'statement', name: 'RATE', path: 'statement#0', startLine: 1, endLine: 1, source: true, loaded: true, crossings: [] },
      ] }],
    };
    const relations = relationsOfFiles(
      [{ file }, { file: 'test/cart.test.ts' }, { file: 'test/mocked.test.ts', edges: [{ to: file, kind: 'imports' as const }] }],
      { shadows: new Map([['test/mocked.test.ts', [file]]]) },
    );

    expect(both(index, 1, relations)).toEqual({ file: 'unwalked', change: 'unwalked', target: 'unwalked' });
  });

  it('stays loaded when a recorded case loads through an import the scan could not read', () => {
    // `mocked.test.ts` mocks `total.ts`; `cart.test.ts` loads the real one
    // through `import('./' + name)`, an edge the graph does not hold.
    const index: ExecutionIndex = {
      tests,
      modules: [{ file, blocks: [
        { kind: 'statement', name: 'RATE', path: 'statement#0', startLine: 1, endLine: 1, source: true, loaded: true, crossings: [] },
      ] }],
    };
    const relations = relationsOfFiles(
      [
        { file },
        { file: 'test/cart.test.ts', unknown: 'a computed dynamic import' },
        { file: 'test/mocked.test.ts', edges: [{ to: file, kind: 'imports' as const }] },
      ],
      { shadows: new Map([['test/mocked.test.ts', [file]]]) },
    );

    expect(both(index, 1, relations)).toEqual({ file: 'loaded', change: 'loaded', target: 'loaded' });
  });

  it('is unwalked when the only case with an import the scan could not read mocks the module itself', () => {
    // A mock replaces the module on every route, a computed one included.
    const index: ExecutionIndex = {
      tests,
      modules: [{ file, blocks: [
        { kind: 'statement', name: 'RATE', path: 'statement#0', startLine: 1, endLine: 1, source: true, loaded: true, crossings: [] },
      ] }],
    };
    const relations = relationsOfFiles(
      [
        { file },
        { file: 'test/cart.test.ts' },
        { file: 'test/mocked.test.ts', edges: [{ to: file, kind: 'imports' as const }], unknown: 'a computed dynamic import' },
      ],
      { shadows: new Map([['test/mocked.test.ts', [file]]]) },
    );

    expect(both(index, 1, relations)).toEqual({ file: 'unwalked', change: 'unwalked', target: 'unwalked' });
  });

  it('stays loaded when the import the scan could not read is in a file a recorded case reaches', () => {
    const helper = 'test/load-page.ts';
    const index: ExecutionIndex = {
      tests,
      modules: [{ file, blocks: [
        { kind: 'statement', name: 'RATE', path: 'statement#0', startLine: 1, endLine: 1, source: true, loaded: true, crossings: [] },
      ] }],
    };
    const relations = relationsOfFiles(
      [
        { file },
        { file: helper, unknown: 'a computed dynamic import' },
        { file: 'test/cart.test.ts', edges: [{ to: helper, kind: 'imports' as const }] },
        { file: 'test/mocked.test.ts', edges: [{ to: file, kind: 'imports' as const }] },
      ],
      { shadows: new Map([['test/mocked.test.ts', [file]]]) },
    );

    expect(both(index, 1, relations)).toEqual({ file: 'loaded', change: 'loaded', target: 'loaded' });
  });

  it('stays loaded when the graph holds no file the module is', () => {
    // The graph carries a mock, but not this module: it cannot say who loaded it.
    const index: ExecutionIndex = {
      tests,
      modules: [{ file, blocks: [
        { kind: 'statement', name: 'RATE', path: 'statement#0', startLine: 1, endLine: 1, source: true, loaded: true, crossings: [] },
      ] }],
    };
    const relations = relationsOfFiles(
      [{ file: 'src/other.ts' }, ...tests.map((test) => ({ file: test.file, edges: [{ to: 'src/other.ts', kind: 'imports' as const }] }))],
      { shadows: new Map([['test/mocked.test.ts', ['src/other.ts']]]) },
    );

    expect(both(index, 1, relations)).toEqual({ file: 'loaded', change: 'loaded', target: 'loaded' });
  });

  it('puts a caller at the distance it called from, not the distance it loaded from', () => {
    const index: ExecutionIndex = {
      tests,
      modules: [{ file, blocks: [
        { kind: 'function', name: 'priceOf', path: 'entry', startLine: 3, endLine: 9, source: true, crossings: [
          { test: 0, distance: 0, loaded: true },
          { test: 0, distance: 2 },
        ] },
      ] }],
    };
    const range = coveringTestsInFile(index, file, {}).find((one) => one.startLine === 3);
    const region = coveringChange(index, new Map([[file, [{ start: 4, end: 4 }]]]), {})[0]?.regions[0];

    expect(range?.tests.map((test) => [test.id, test.distance, test.loaded])).toEqual([['guest', 2, undefined]]);
    expect(region?.tests.map((test) => [test.id, test.distance])).toEqual([['guest', 2]]);
  });

  it('is entered, loaded, a hole, unwalked or unknown, from the cases on it and the cases that stopped', () => {
    const guest = { ...tests[0]!, distance: 0 };
    expect(reachOf({ tests: [guest] })).toBe('entered');
    expect(reachOf({ tests: [{ ...guest, loaded: true }] })).toBe('loaded');
    expect(reachOf({ tests: [], loaded: true })).toBe('loaded');
    expect(reachOf({ tests: [], stopped: [tests[0]!] })).toBe('hole');
    expect(reachOf({ tests: [], stopped: [] })).toBe('unwalked');
    expect(reachOf({ tests: [] })).toBe('unknown');
  });
});
