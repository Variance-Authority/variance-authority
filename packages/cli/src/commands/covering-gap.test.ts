import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Placement } from '@variance-authority/sense/test-selection';
import { readFlags } from '../args.js';
import { parseCoveringArgs } from '../covering-args.js';
import { flagsFor, synopsisFor } from '../usage.js';
import { covering, formatCovering } from './covering.js';

/** The frame the next question is read in; none, as for an index no snapshot sits beside, unless a case sets one. */
let framed: Placement | undefined;

vi.mock('./covering-frame.js', async (original) => ({
  ...await original<typeof import('./covering-frame.js')>(),
  placementFor: async () => framed,
}));

afterEach(() => {
  framed = undefined;
});

// Every case loaded the module; `records` ran `Ledger/record`, `finds` ran
// `Ledger/first`, `books` ran `LedgerBook`. Lines 18-29 are the module's alone.
const INDEX = {
  tests: [
    { id: 'loads', file: 'load.test.ts', name: 'loads the ledger' },
    { id: 'records', file: 'ledger.test.ts', name: 'records an entry' },
    { id: 'finds', file: 'ledger.test.ts', name: "finds the user's entry" },
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
      { kind: 'function', name: 'LedgerBook', path: 'entry', startLine: 30, endLine: 34, source: true, crossings: [{ test: 3, distance: 0 }] },
    ],
  }],
};

async function ask(...argv: string[]) {
  const dir = await mkdtemp(join(tmpdir(), 'variance-covering-gap-'));
  const execution = join(dir, 'cases.json');
  await writeFile(execution, JSON.stringify(INDEX));
  return covering(parseCoveringArgs(readFlags(
    ['--file', 'src/ledger.ts', ...argv, '--execution', execution, '--root', dir],
    'covering', flagsFor('covering'), synopsisFor('covering'),
  )));
}

/** A frame in which the held text differs from the recorded one: `written` lines were written since, and `moved` regions were edited. */
function mapped(written: readonly number[], moved: readonly string[] = []): Placement {
  return {
    frame: 'mapped',
    place: (range) => ({ lines: range, moved: moved.includes(`${range.startLine}-${range.endLine}`) }),
    recordedLine: (line) => (written.includes(line) ? undefined : line),
  };
}

describe('a line the record holds at file grain', () => {
  it('ends with a Deep gap naming the story of the three nearest tests, as story.md has them recorded, in the order the answer lists them', async () => {
    const answer = await ask('--line', '20');

    expect(answer.gap).toEqual({
      question: 'which of these tests ran it, and in what order',
      scope: 'line 20 of src/ledger.ts',
      known: '4 named tests loaded src/ledger.ts',
      reason: 'coarse',
      gear: 'deep',
      run: {
        cases: [
          { file: 'ledger.test.ts', name: "finds the user's entry" },
          { file: 'ledger.test.ts', name: 'records an entry' },
          { file: 'book.test.ts', name: 'opens a book' },
        ],
        story: true,
      },
      next: [
        "variance story --file ledger.test.ts --name 'finds the user'\\''s entry'",
        "variance story --file ledger.test.ts --name 'records an entry'",
        "variance story --file book.test.ts --name 'opens a book'",
      ],
      cost: { tests: 3, files: 2 },
    });
    expect(JSON.parse(formatCovering(answer, 'json')).gap).toEqual(answer.gap);
  });

  it('says the gap last in the text, with its reason, its gear, its cost and the commands', async () => {
    const text = formatCovering(await ask('--line', '20'), 'text');

    expect(text.trimEnd().endsWith([
      'Gap (coarse) on line 20 of src/ledger.ts: which of these tests ran it, and in what order. Known: 4 named tests loaded src/ledger.ts.',
      'Next, Deep, 3 tests in 2 test files:',
      "  Run each case with the suite's own runner under VARIANCE_AUTHORITY_STORY=1, filtered by its name (-t; --grep under Playwright):",
      "    ledger.test.ts  'finds the user'\\''s entry'",
      "    ledger.test.ts  'records an entry'",
      "    book.test.ts  'opens a book'",
      "  variance story --file ledger.test.ts --name 'finds the user'\\''s entry'",
      "  variance story --file ledger.test.ts --name 'records an entry'",
      "  variance story --file book.test.ts --name 'opens a book'",
    ].join('\n'))).toBe(true);
  });

  it('opens a Deep gap for a run of lines that holds some at file grain', async () => {
    const answer = await ask('--line', '7-20');

    expect(answer.gap).toMatchObject({ reason: 'coarse', gear: 'deep', scope: 'lines 7-20 of src/ledger.ts', cost: { tests: 3, files: 2 } });
  });
});

describe('an answer that leaves nothing open', () => {
  it('prints no gap for a line a function holds', async () => {
    const answer = await ask('--line', '7');

    expect(answer.gap).toBeUndefined();
    expect(formatCovering(answer, 'text')).not.toContain('Gap');
    expect(JSON.parse(formatCovering(answer, 'json'))).not.toHaveProperty('gap');
  });

  it('prints no gap for lines no recorded region holds, since no record could hold them', async () => {
    const answer = await ask('--line', '41-42');

    expect(answer.outside).toEqual([{ startLine: 41, endLine: 42 }]);
    expect(answer.gap).toBeUndefined();
  });
});

describe('a line written since the recording', () => {
  it('ends with a Record gap over the test files that ran code in the file, before any Deep one', async () => {
    framed = mapped([20]);
    const answer = await ask('--line', '19-20');

    expect(answer.written).toEqual([{ startLine: 20, endLine: 20 }]);
    expect(answer.gap).toEqual({
      question: 'which tests run it now',
      scope: 'lines 19-20 of src/ledger.ts',
      known: 'line 20 was written since the recording',
      reason: 'stale',
      gear: 'record',
      run: { files: ['ledger.test.ts', 'book.test.ts', 'load.test.ts'] },
      next: [],
      cost: { tests: 4, files: 3 },
    });
    expect(formatCovering(answer, 'text')).toContain("Next, Record, 4 tests in 3 test files:\n  Run with the suite's own runner: ledger.test.ts book.test.ts load.test.ts");
  });
});

describe('a file whose recorded ranges were edited since', () => {
  it('ends with a Record gap over the test files that ran the edited ranges', async () => {
    framed = mapped([], ['6-8']);
    const answer = await ask();

    expect(answer.ranges?.some((range) => range.moved === true)).toBe(true);
    expect(answer.gap).toMatchObject({
      question: 'which tests run the edited ranges now',
      scope: 'src/ledger.ts',
      reason: 'stale',
      gear: 'record',
      run: { files: ['ledger.test.ts'] },
      next: [],
      cost: { tests: 2, files: 1 },
    });
  });

  it('prints no gap when no range was edited', async () => {
    framed = mapped([]);

    expect((await ask()).gap).toBeUndefined();
  });
});
