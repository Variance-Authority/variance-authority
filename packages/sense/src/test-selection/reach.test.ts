import { relationsOfFiles } from '@variance-authority/core/relate';
import { describe, expect, it } from 'vitest';
import { reachOf, regionRecord } from './range-state.js';
import { coveringChange, coveringTestsInFile, type CoveringRegion, type ExecutionIndex } from './reverse.js';

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
  return { file: range === undefined ? undefined : reachOf(range), change: region === undefined ? undefined : reachOf(regionRecord(region)) };
}

describe('the reach of a region', () => {
  it('is loaded on both answers when it ran while its module evaluated and no graph names who loaded it', () => {
    const index: ExecutionIndex = {
      tests,
      modules: [{ file, blocks: [
        { kind: 'statement', name: 'RATE', path: 'statement#0', startLine: 1, endLine: 1, source: true, loaded: true, crossings: [] },
      ] }],
    };

    expect(both(index, 1)).toEqual({ file: 'loaded', change: 'loaded' });
  });

  it('is loaded on both answers when the producer wrote load time on the crossing', () => {
    const index: ExecutionIndex = {
      tests,
      modules: [{ file, blocks: [
        { kind: 'statement', name: 'RATE', path: 'statement#0', startLine: 1, endLine: 1, source: true, crossings: [{ test: 0, distance: 0, loaded: true }] },
      ] }],
    };

    expect(both(index, 1)).toEqual({ file: 'loaded', change: 'loaded' });
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

    expect(both(index, 4, relations)).toEqual({ file: 'unwalked', change: 'unwalked' });
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
