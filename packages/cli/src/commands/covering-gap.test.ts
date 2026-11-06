import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { updateSourceIndex } from '@variance-authority/sense';
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
    { id: 'books', file: 'book.test.ts', name: 'opens a [draft] book (v2+)?' },
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
  // Under CI nothing builds the source index implicitly; the fixture publishes it, as the pipeline's `variance index` step does.
  execFileSync('git', ['init', '--quiet', dir]);
  await updateSourceIndex(dir);
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
  it('ends with a Deep gap naming the story of the three nearest tests, in the order the answer lists them, and the one it leaves unread', async () => {
    const answer = await ask('--line', '20');

    expect(answer.gap).toEqual({
      question: 'which of the nearest 3 ran it, and in what order',
      scope: 'line 20 of src/ledger.ts',
      known: '4 named tests loaded src/ledger.ts, and 1 past the nearest 3 stays unread',
      reason: 'coarse',
      remedy: 'deep',
      run: {
        cases: [
          { file: 'ledger.test.ts', name: "finds the user's entry", pattern: "finds the user's entry" },
          { file: 'ledger.test.ts', name: 'records an entry', pattern: 'records an entry' },
          { file: 'book.test.ts', name: 'opens a [draft] book (v2+)?', pattern: 'opens a \\[draft\\] book \\(v2\\+\\)\\?' },
        ],
        story: true,
      },
      next: [
        "variance story --file ledger.test.ts --name 'finds the user'\\''s entry'",
        "variance story --file ledger.test.ts --name 'records an entry'",
        "variance story --file book.test.ts --name 'opens a [draft] book (v2+)?'",
      ],
      cost: { tests: 3, files: 2 },
    });
    expect(JSON.parse(formatCovering(answer, 'json', Date.now())).gap).toEqual(answer.gap);
  });

  it('says the gap last in the text, with its reason, its remedy, its cost and the commands', async () => {
    const text = formatCovering(await ask('--line', '20'), 'text', Date.now());

    expect(text.trimEnd().endsWith([
      'Gap (coarse) on line 20 of src/ledger.ts: which of the nearest 3 ran it, and in what order. Known: 4 named tests loaded src/ledger.ts, and 1 past the nearest 3 stays unread.',
      'Next, Deep, 3 tests in 2 test files:',
      "  Run each case with the suite's own runner under VARIANCE_AUTHORITY_STORY=1, filtered by its name as a regular expression (-t; --grep under Playwright):",
      "    ledger.test.ts  'finds the user'\\''s entry'",
      "    ledger.test.ts  'records an entry'",
      "    book.test.ts  'opens a \\[draft\\] book \\(v2\\+\\)\\?'",
      "  variance story --file ledger.test.ts --name 'finds the user'\\''s entry'",
      "  variance story --file ledger.test.ts --name 'records an entry'",
      "  variance story --file book.test.ts --name 'opens a [draft] book (v2+)?'",
    ].join('\n'))).toBe(true);
  });

  it('asks of every test that loaded the file when the story reads them all', async () => {
    const answer = await ask('--line', '20', '--cases', 'ledger.test.ts');

    expect(answer.gap).toMatchObject({ question: 'which of these tests ran it, and in what order', known: '2 named tests loaded src/ledger.ts' });
  });

  it('opens a Deep gap for a run of lines that holds some at file grain', async () => {
    const answer = await ask('--line', '7-20');

    expect(answer.gap).toMatchObject({ reason: 'coarse', remedy: 'deep', scope: 'lines 7-20 of src/ledger.ts', cost: { tests: 3, files: 2 } });
  });
});

describe('an answer that leaves nothing open', () => {
  it('prints no gap for a line a function holds', async () => {
    const answer = await ask('--line', '7');

    expect(answer.gap).toBeUndefined();
    expect(formatCovering(answer, 'text', Date.now())).not.toContain('Gap');
    expect(JSON.parse(formatCovering(answer, 'json', Date.now()))).not.toHaveProperty('gap');
  });

  it('prints no gap for lines no recorded region holds, since no record could hold them', async () => {
    const answer = await ask('--line', '41-42');

    expect(answer.outside).toEqual([{ startLine: 41, endLine: 42 }]);
    expect(answer.gap).toBeUndefined();
  });
});

describe('a line written since the recording', () => {
  it('ends with a Record gap over the test files selection runs for the file, before any Deep one', async () => {
    framed = mapped([20]);
    const answer = await ask('--line', '19-20');

    // A record that names no commit says nothing of which text its cases ran over.
    expect(answer.unknown).toEqual({ lines: [{ startLine: 20, endLine: 20 }], why: 'the record names no commit' });
    expect(answer.gap).toEqual({
      question: 'which tests run it now',
      scope: 'lines 19-20 of src/ledger.ts',
      known: 'line 20 is of a text the record cannot say a case ran over',
      reason: 'stale',
      remedy: 'record',
      run: { files: ['book.test.ts', 'ledger.test.ts', 'load.test.ts'] },
      next: [],
      cost: { tests: 4, files: 3 },
    });
    expect(formatCovering(answer, 'text', Date.now())).toContain("Next, Record, 4 tests in 3 test files:\n  Run with the suite's own runner: book.test.ts ledger.test.ts load.test.ts");
  });
});

describe('a file whose recorded ranges were edited since', () => {
  it('ends with a Record gap over the test files selection runs for the file, every one that loaded it', async () => {
    framed = mapped([], ['6-8']);
    const answer = await ask();

    expect(answer.ranges?.some((range) => range.moved === true)).toBe(true);
    expect(answer.gap).toMatchObject({
      question: 'which tests run the edited ranges now',
      scope: 'src/ledger.ts',
      reason: 'stale',
      remedy: 'record',
      run: { files: ['book.test.ts', 'ledger.test.ts', 'load.test.ts'] },
      next: [],
      cost: { tests: 4, files: 3 },
    });
  });

  it('prints no gap when no range was edited', async () => {
    framed = mapped([]);

    expect((await ask()).gap).toBeUndefined();
  });
});

describe('an answer held at file grain', () => {
  it.todo('a --function / --since / precondition answer held at file grain ends with its gap — needs a gap scope for a function, a diff and a precondition, which `gapScope` names only for a file, a line or a run of lines');
});
