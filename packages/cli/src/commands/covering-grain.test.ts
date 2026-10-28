import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFlags } from '../args.js';
import { parseCoveringArgs } from '../covering-args.js';
import { flagsFor, synopsisFor } from '../usage.js';
import { covering, formatCovering } from './covering.js';

// A module every case entered at its top level, a class of two methods with a
// callback in one, and a function whose name begins like the class's. Lines
// 18-29 are the module's alone.
const INDEX = {
  tests: [
    { id: 'loads', file: 'load.test.ts', name: 'loads the ledger' },
    { id: 'records', file: 'ledger.test.ts', name: 'records an entry' },
    { id: 'finds', file: 'ledger.test.ts', name: 'finds an entry' },
    { id: 'books', file: 'book.test.ts', name: 'opens a book' },
  ],
  modules: [{
    file: 'src/ledger.ts',
    blocks: [
      {
        kind: 'module', name: '', path: 'module', startLine: 1, endLine: 40, source: true,
        crossings: [0, 1, 2, 3].map((test) => ({ test, distance: 0 })),
      },
      { kind: 'function', name: 'Ledger/record', path: 'entry', startLine: 5, endLine: 9, source: true, crossings: [{ test: 1, distance: 0 }] },
      { kind: 'function', name: 'Ledger/first', path: 'entry', startLine: 11, endLine: 17, source: true, crossings: [{ test: 2, distance: 0 }] },
      { kind: 'function', name: 'Ledger/first/find.arg0', path: 'entry', startLine: 13, endLine: 13, source: true, crossings: [{ test: 2, distance: 0 }] },
      { kind: 'function', name: 'LedgerBook', path: 'entry', startLine: 30, endLine: 34, source: true, crossings: [{ test: 3, distance: 0 }] },
    ],
  }],
};

async function indexFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'variance-covering-grain-'));
  const file = join(dir, 'cases.json');
  await writeFile(file, JSON.stringify(INDEX));
  return file;
}

function parse(argv: readonly string[]) {
  return parseCoveringArgs(readFlags(argv, 'covering', flagsFor('covering'), synopsisFor('covering')));
}

async function ask(...argv: string[]) {
  return covering(parse(['--file', 'src/ledger.ts', ...argv, '--execution', await indexFile()]));
}

describe('asking a run of lines', () => {
  it('reads `--line a-b` as a range, `a-a` as one line, and refuses one that runs backwards', () => {
    expect(parse(['--file', 'a.ts', '--line', '10-20'])).toMatchObject({ lines: { startLine: 10, endLine: 20 } });
    expect(parse(['--file', 'a.ts', '--line', '7-7'])).toMatchObject({ line: 7 });
    expect(() => parse(['--file', 'a.ts', '--line', '20-10'])).toThrow(/runs backwards/);
    expect(() => parse(['--file', 'a.ts', '--line', 'x-y'])).toThrow(/positive integer/);
  });

  it('answers a run inside one method with the cases that entered it, and nothing at file grain', async () => {
    const answer = await ask('--line', '6-8');

    expect(answer.tests?.map((test) => test.id)).toEqual(['records']);
    expect(answer.target).toEqual({ lines: { startLine: 6, endLine: 8 } });
    expect(answer.fileGrain).toBeUndefined();
    expect(formatCovering(answer, 'text', Date.now())).toContain('1 named test covered lines 6-8 of src/ledger.ts');
  });

  it('names every line of a range that charges the module, whose cases are the ones that loaded the file', async () => {
    const answer = await ask('--line', '7-20');

    // Lines 9, 11 and 17 open or close a method, so an edit there charges the module's region as well.
    expect(answer.tests?.map((test) => test.id)).toEqual(['books', 'finds', 'records', 'loads']);
    expect(answer.grain).toBeUndefined();
    expect(answer.fileGrain).toEqual([{ startLine: 9, endLine: 11 }, { startLine: 17, endLine: 20 }]);
    expect(formatCovering(answer, 'text', Date.now())).toContain(
      'Lines 9-11, 17-20 charge the module\'s own region: for them the record names the cases that loaded the file.',
    );
    expect(formatCovering(answer, 'refs', Date.now())).toContain('; file grain at 9-11, 17-20');
  });

  it('names a method\'s first and last line when a range spans the whole method', async () => {
    const answer = await ask('--line', '5-9');

    expect(answer.tests?.map((test) => test.id)).toEqual(['books', 'finds', 'records', 'loads']);
    expect(answer.fileGrain).toEqual([{ startLine: 5, endLine: 5 }, { startLine: 9, endLine: 9 }]);
  });

  it('names the lines of a range no recorded region holds', async () => {
    const answer = await ask('--line', '38-42');

    expect(answer.grain).toBe('file');
    expect(answer.outside).toEqual([{ startLine: 41, endLine: 42 }]);
    expect(formatCovering(answer, 'text', Date.now())).toContain('Lines 41-42 are outside every recorded region, so no case can be said to have run them.');
    expect(formatCovering(answer, 'refs', Date.now())).toContain('; outside every region at 41-42');
  });

  it('answers a range only the module holds at file grain, and says so', async () => {
    const answer = await ask('--line', '19-21');

    expect(answer.tests?.map((test) => test.id)).toEqual(['books', 'finds', 'records', 'loads']);
    expect(answer.grain).toBe('file');
    expect(answer.fileGrain).toBeUndefined();
  });
});

describe('asking a line only the module holds', () => {
  it('answers with the cases that loaded the file and says it is file grain, in text, refs and JSON', async () => {
    const answer = await ask('--line', '20');

    expect(answer.tests).toHaveLength(4);
    expect(JSON.parse(formatCovering(answer, 'json', Date.now())).grain).toBe('file');
    expect(formatCovering(answer, 'text', Date.now())).toContain(
      'At file grain: an edit to line 20 charges the module\'s own region',
    );
    expect(formatCovering(answer, 'refs', Date.now())).toContain('src/ledger.ts line 20 at file grain');
  });

  it('carries no grain on a line a function holds', async () => {
    expect((await ask('--line', '7')).grain).toBeUndefined();
  });

  it('answers a method\'s closing line at file grain, since an edit there charges the module', async () => {
    const answer = await ask('--line', '9');

    expect(answer.grain).toBe('file');
    expect(formatCovering(answer, 'text', Date.now())).toContain(
      'At file grain: an edit to line 9 charges the module\'s own region, so the record names the cases that loaded the file.',
    );
  });
});

describe('asking a scope', () => {
  it('answers a class with every case that entered one of its methods', async () => {
    const answer = await ask('--function', 'Ledger');

    expect(answer.tests?.map((test) => test.id)).toEqual(['finds', 'records']);
    expect(answer.target).toEqual({ function: 'Ledger' });
  });

  it('refuses a name no recorded function is under, and never a namesake\'s prefix or a bare method name', async () => {
    await expect(ask('--function', 'Ledge')).rejects.toThrow(/not a recorded function or scope/);
    await expect(ask('--function', 'record')).rejects.toThrow(/Ledger\/record/);
  });
});
