import { describe, expect, it } from 'vitest';
import { relationsOfFiles } from '@variance-authority/core/relate';
import { coveringTests, stoppedBefore, type ExecutionIndex } from './reverse.js';
import { functionsUnder, lineGrain } from './source-target.js';

// A module whose top level every case loaded, a class of two methods, a
// callback inside one of them, and a function whose name begins like the class's.
const index: ExecutionIndex = {
  tests: [
    { id: 'loads', file: 'test/load.test.ts', name: 'loads the ledger' },
    { id: 'records', file: 'test/ledger.test.ts', name: 'records an entry' },
    { id: 'finds', file: 'test/ledger.test.ts', name: 'finds an entry' },
    { id: 'books', file: 'test/book.test.ts', name: 'opens a book' },
  ],
  modules: [{
    file: 'src/ledger.ts',
    blocks: [
      {
        kind: 'module', name: '', path: 'module', startLine: 1, endLine: 40, source: true,
        crossings: [0, 1, 2, 3].map((test) => ({ test, distance: 0, loaded: true })),
      },
      { kind: 'function', name: 'Ledger/record', path: 'entry', startLine: 5, endLine: 9, source: true, crossings: [{ test: 1, distance: 0 }] },
      { kind: 'function', name: 'Ledger/first', path: 'entry', startLine: 11, endLine: 17, source: true, crossings: [{ test: 2, distance: 0 }] },
      { kind: 'function', name: 'Ledger/first/find.arg0', path: 'entry', startLine: 13, endLine: 13, source: true, crossings: [{ test: 2, distance: 0 }] },
      { kind: 'function', name: 'LedgerBook', path: 'entry', startLine: 30, endLine: 34, source: true, crossings: [{ test: 3, distance: 0 }] },
    ],
  }],
};

const module = index.modules[0]!;
const ids = (target: Parameters<typeof coveringTests>[1]) => coveringTests(index, target).map((test) => test.id);

describe('the grain the record holds a line at', () => {
  it('is a region inside a function, the file on a line only the module holds, and nothing outside every region', () => {
    expect(lineGrain(module.blocks, 7)).toBe('region');
    expect(lineGrain(module.blocks, 20)).toBe('file');
    expect(lineGrain(module.blocks, 41)).toBeUndefined();
  });

  it('is the file on a line that opens or closes a function, since an edit there charges the module as well', () => {
    expect(lineGrain(module.blocks, 5)).toBe('file');
    expect(lineGrain(module.blocks, 9)).toBe('file');
    // The callback on line 13 opens inside a method, so it charges the method and not the module.
    expect(lineGrain(module.blocks, 13)).toBe('region');
  });
});

describe('asking a range of lines', () => {
  it('answers every region one of its lines is charged to, as a selection over an edit to them would', () => {
    expect(ids({ file: 'src/ledger.ts', lines: [7, 8] })).toEqual(['records']);
    // Line 9 closes the method, so it charges the module's region as well as the method's.
    expect(ids({ file: 'src/ledger.ts', lines: [8, 9] })).toEqual(['books', 'finds', 'records', 'loads']);
  });

  it('answers at file grain when no line of the range is held by anything narrower', () => {
    expect(ids({ file: 'src/ledger.ts', lines: [19, 20, 21] })).toEqual(['books', 'finds', 'records', 'loads']);
  });

  it('reads the stopped cases over the same regions it answers from', () => {
    // `finds` entered `Ledger/first` and then threw: it stopped before `Ledger/record`.
    const settled: ExecutionIndex = {
      ...index,
      tests: index.tests.map((test) => ({ ...test, stopped: test.id === 'finds' })),
      modules: [{ ...module, blocks: module.blocks.filter((block) => block.kind !== 'module') }],
    };
    const relations = relationsOfFiles([
      { file: 'src/ledger.ts' },
      ...['test/load.test.ts', 'test/ledger.test.ts', 'test/book.test.ts'].map((file) => ({ file, edges: [{ to: 'src/ledger.ts', kind: 'imports' as const }] })),
    ]);
    const stopped = (target: Parameters<typeof stoppedBefore>[1]) => stoppedBefore(settled, target, { relations })?.map((test) => test.id);

    expect(stopped({ file: 'src/ledger.ts', lines: [7, 8] })).toEqual(['finds']);
    expect(stopped({ file: 'src/ledger.ts', lines: [7, 14] })).toEqual([]);
    expect(stopped({ file: 'src/ledger.ts', function: 'Ledger' })).toEqual([]);
  });
});

describe('asking a scope that owns recorded functions', () => {
  it('answers a class with every case that entered one of its methods', () => {
    expect(ids({ file: 'src/ledger.ts', function: 'Ledger' })).toEqual(['finds', 'records']);
  });

  it('answers a function with the functions written inside it', () => {
    expect(functionsUnder(module.blocks, 'Ledger/first').map((block) => block.name)).toEqual(['Ledger/first', 'Ledger/first/find.arg0']);
  });

  it('never answers a name with a function whose name only begins like it', () => {
    expect(functionsUnder(module.blocks, 'Ledger').map((block) => block.name)).not.toContain('LedgerBook');
    expect(functionsUnder(module.blocks, 'record')).toEqual([]);
  });
});
