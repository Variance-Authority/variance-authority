import { describe, expect, it } from 'vitest';
import { frameText, ranText } from './covering-fresh-text.js';
import type { CoveringRan, RanStand } from './covering-ran.js';
import type { Covering } from './covering.js';

/**
 * The sentences a `covering` answer says of how fresh and how actual it is:
 * one for where its line numbers stand in the asked text, and, apart from
 * that, one per group of test files for whether they ran over it and when.
 */

const NOW = Date.parse('2026-10-28T12:00:00.000Z');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const at = (ago: number): string => new Date(NOW - ago).toISOString();
/** When a stand's runs landed, `first` and `latest` ms ago; `null` runs for a record that holds no count. */
const landed = (first: number, latest = first, runs: number | null = 1): RanStand['landed'] => ({ first: at(first), latest: at(latest), ...(runs === null ? {} : { runs }) });
const of = (ran: CoveringRan, more: Partial<Covering> = {}): Covering => ({ file: 'src/pay.ts', ran, ...more }) as Covering;

describe('frameText', () => {
  it('says nothing of a file whose lines are numbered in the asked text', () => {
    expect(frameText({ file: 'src/pay.ts', frame: 'recorded' } as Covering)).toEqual([]);
  });

  it('says once that an edited file\'s lines are placed in the text as it is now', () => {
    expect(frameText({ file: 'src/pay.ts', frame: 'mapped' } as Covering)).toEqual(['The recorded lines of src/pay.ts are placed in its text as it is now.']);
  });

  it('says of a function in a file whose numbering text is lost what that takes away, and leaves a stale file to its own answer', () => {
    expect(frameText({ file: 'src/pay.ts', frame: 'stale', target: { function: 'pay' } } as Covering)).toEqual([
      'src/pay.ts is not the text the record\'s lines are numbered in, and that text could not be found, so no recorded line is a place in it. Which parts of `pay` no case ran are not said for that reason.',
    ]);
    expect(frameText({ file: 'src/pay.ts', frame: 'stale' } as Covering)).toEqual([]);
  });

  it('says a file not on disk holds no text, and that its lines are the record\'s unless it is a precondition', () => {
    expect(frameText({ file: 'src/pay.ts', unheld: true } as Covering)).toEqual(['src/pay.ts is not on disk, so no text of it is held; its lines are the record\'s.']);
    expect(frameText({ file: 'src/setup.ts', unheld: true, preconditionOf: ['src/pay.test.ts'] } as Covering)).toEqual(['src/setup.ts is not on disk, so no text of it is held.']);
  });

  it('says nothing of a precondition it holds, which has no line to number', () => {
    expect(frameText({ file: 'src/setup.ts', preconditionOf: ['src/pay.test.ts'] } as Covering)).toEqual([]);
  });

  it('says the lines are given as recorded when the record does not say which text they are numbered in', () => {
    expect(frameText({ file: 'src/pay.ts' } as Covering)).toEqual(['The record does not say which text of src/pay.ts its lines are numbered in, so they are given as recorded.']);
  });

  it('says nothing under a review reading', () => {
    expect(frameText({ changed: [] } as unknown as Covering)).toEqual([]);
  });
});

describe('ranText', () => {
  it('says nothing of an answer that names no test file', () => {
    expect(ranText({ file: 'src/pay.ts' } as Covering, NOW)).toEqual([]);
  });

  it('says once that the asked text is the one the test files named ran over, and when their runs landed', () => {
    const ran: CoveringRan = { stands: [
      { commit: 'a', tests: ['src/pay.test.ts'], landed: landed(9 * HOUR + MINUTE), text: 'held' },
      { commit: 'b', tests: ['src/fee.test.ts'], landed: landed(6 * MINUTE), text: 'held' },
    ] };
    expect(ranText(of(ran), NOW)).toEqual(['src/pay.ts is the text the 2 test files named here ran over, in runs that landed from 9 hours ago to 6 minutes ago.']);
  });

  it('gives a single landing, a span, a count the record does not hold, and a landing later than the clock', () => {
    const held = (when: RanStand['landed']): readonly string[] => ranText(of({ stands: [{ commit: 'a', tests: ['src/pay.test.ts'], ...(when === undefined ? {} : { landed: when }), text: 'held' }] }), NOW);
    expect(held(landed(30_000))).toEqual(['src/pay.ts is the text the test file named here ran over, in a run that landed under a minute ago.']);
    expect(held(landed(3 * 24 * HOUR, 3 * HOUR, 4))).toEqual(['src/pay.ts is the text the test file named here ran over, in runs that landed from 3 days ago to 3 hours ago.']);
    expect(held(landed(2 * HOUR, 2 * HOUR, null))).toEqual(['src/pay.ts is the text the test file named here ran over, in a run that landed 2 hours ago.']);
    expect(held(landed(3 * HOUR, HOUR, null))).toEqual(['src/pay.ts is the text the test file named here ran over, in runs that landed from 3 hours ago to 1 hour ago.']);
    expect(held(undefined)).toEqual(['src/pay.ts is the text the test file named here ran over, at a time the record does not hold.']);
    expect(held(landed(-HOUR))).toEqual([`src/pay.ts is the text the test file named here ran over, in a run that landed at ${at(-HOUR)}, later than this machine's clock.`]);
  });

  it('says what of a group the record holds no time for', () => {
    const ran: CoveringRan = { stands: [
      { commit: 'a', tests: ['src/pay.test.ts'], text: 'held' },
      { commit: 'b', tests: ['src/fee.test.ts'], landed: landed(6 * MINUTE), text: 'held' },
    ] };
    expect(ranText(of(ran), NOW)).toEqual(['src/pay.ts is the text the 2 test files named here ran over, in a run that landed 6 minutes ago, and at a time the record does not hold.']);
  });

  it('names each group that ran over another text, oldest first, with whether the asked function is the same in both', () => {
    const ran: CoveringRan = { stands: [
      { commit: 'c', tests: ['src/fee.test.ts'], landed: landed(6 * MINUTE), text: 'held' },
      { commit: 'b', tests: ['src/tax.test.ts'], landed: landed(2 * HOUR), text: 'other', other: ['src/pay.ts'], region: 'changed' },
      { commit: 'a', tests: ['src/pay.test.ts'], landed: landed(9 * HOUR), text: 'other', other: ['src/pay.ts'], region: 'same' },
      { commit: 'd', tests: ['src/old.test.ts'], text: 'other', other: ['src/pay.ts'], region: { unknown: 'the text of src/pay.ts that run ran over is neither kept nor committed' } },
    ] };
    expect(ranText(of(ran, { target: { function: 'pay' } }), NOW)).toEqual([
      'src/old.test.ts ran over another text of src/pay.ts, at a time the record does not hold; whether `pay` differs is not known: the text of src/pay.ts that run ran over is neither kept nor committed.',
      'src/pay.test.ts ran over another text of src/pay.ts, in a run that landed 9 hours ago; `pay` is the same in both.',
      'src/tax.test.ts ran over another text of src/pay.ts, in a run that landed 2 hours ago; `pay` differs between the two.',
      'src/pay.ts is the text the other test file named here ran over, in a run that landed 6 minutes ago.',
    ]);
  });

  it('names an asked line or run of lines as the region', () => {
    const ran: CoveringRan = { stands: [{ commit: 'a', tests: ['src/pay.test.ts'], text: 'other', other: ['src/pay.ts'], region: 'same' }] };
    expect(ranText(of(ran, { target: { line: 3 } }), NOW)).toEqual(['src/pay.test.ts ran over another text of src/pay.ts, at a time the record does not hold; line 3 is the same in both.']);
    expect(ranText(of(ran, { target: { lines: { startLine: 2, endLine: 4 } } }), NOW)).toEqual([
      'src/pay.test.ts ran over another text of src/pay.ts, at a time the record does not hold; lines 2-4 are the same in both.',
    ]);
  });

  it('says why whether a group ran the asked text is not known', () => {
    const ran: CoveringRan = { stands: [{ commit: 'a', tests: ['src/pay.test.ts'], landed: landed(2 * HOUR), unknown: 'this clone holds no committed text of src/pay.ts where that run stood' }] };
    expect(ranText(of(ran), NOW)).toEqual([
      'Whether src/pay.test.ts ran over src/pay.ts as it is now, in a run that landed 2 hours ago, is not known: this clone holds no committed text of src/pay.ts where that run stood.',
    ]);
  });

  it('dates the test files when no text was held to compare', () => {
    const ran: CoveringRan = { stands: [{ commit: 'a', tests: ['src/pay.test.ts'], landed: landed(5 * MINUTE) }] };
    expect(ranText(of(ran, { unheld: true }), NOW)).toEqual(['The test file named here last ran in a run that landed 5 minutes ago.']);
  });

  it('says why where and when the test files last ran is not known', () => {
    expect(ranText(of({ tests: ['src/pay.test.ts', 'src/fee.test.ts'], unread: 'the record names no commit' }), NOW)).toEqual([
      'Where and when the 2 test files named here last ran is not known: the record names no commit.',
    ]);
  });

  it('says how many of the test files were placed by assumption, after the lines it dates', () => {
    const one: CoveringRan = { stands: [{ commit: 'a', assumed: true, tests: ['src/pay.test.ts'], text: 'held' }], assumed: 'no runs record lies beside the snapshot' };
    expect(ranText(of(one), NOW)).toEqual([
      'src/pay.ts is the text the test file named here ran over, at a time the record does not hold.',
      'The record does not say where the test file named here last ran, so where it ran is assumed, not observed.',
    ]);
    const some: CoveringRan = { stands: [
      { commit: 'a', assumed: true, tests: ['src/fee.test.ts', 'src/tax.test.ts'], text: 'held' },
      { commit: 'b', tests: ['src/pay.test.ts'], landed: landed(HOUR), text: 'held' },
    ], assumed: 'the runs record does not say where 2 test(s) last ran' };
    expect(ranText(of(some), NOW).at(-1)).toBe('The record does not say where 2 of them last ran, so where they ran is assumed, not observed.');
  });

  it('names the test files that entered the file, or those of every case read, for an answer that names none', () => {
    const stand: RanStand = { commit: 'a', tests: ['src/pay.test.ts'], text: 'held' };
    expect(ranText(of({ stands: [stand], named: 'entered' }), NOW)).toEqual(['src/pay.ts is the text the test file that entered it ran over, at a time the record does not hold.']);
    expect(ranText(of({ stands: [{ ...stand, tests: ['a.test.ts', 'b.test.ts'] }], named: 'read' }), NOW)).toEqual([
      'src/pay.ts is the text the 2 test files read here ran over, at a time the record does not hold.',
    ]);
  });

  it('names up to five test files of a group, then how many more', () => {
    const tests = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((name) => `src/${name}.test.ts`);
    const ran: CoveringRan = { stands: [{ commit: 'a', tests, text: 'other', other: ['src/pay.ts'] }] };
    expect(ranText(of(ran), NOW)).toEqual([
      'src/a.test.ts, src/b.test.ts, src/c.test.ts, src/d.test.ts, src/e.test.ts and 2 other test files ran over another text of src/pay.ts, at a time the record does not hold.',
    ]);
  });

  it('says of a review reading which changed files the test files ran over', () => {
    const answer = {
      changed: [{ file: 'src/pay.ts' }, { file: 'src/fee.ts' }],
      ran: { stands: [
        { commit: 'a', tests: ['src/pay.test.ts'], text: 'held' },
        { commit: 'b', tests: ['src/fee.test.ts'], text: 'other', other: ['src/fee.ts'] },
      ] },
    } as unknown as Covering;
    expect(ranText(answer, NOW)).toEqual([
      'src/pay.ts and src/fee.ts are the texts the other test file named here ran over, at a time the record does not hold.',
      'src/fee.test.ts ran over another text of src/fee.ts, at a time the record does not hold.',
    ]);
  });

  it('claims no text of a changed file that is not on disk, and says it is not', () => {
    const answer = {
      changed: [{ file: 'src/pay.ts' }, { file: 'src/fee.ts' }],
      ran: {
        stands: [
          { commit: 'a', tests: ['src/pay.test.ts'], text: 'held' },
          { commit: 'b', tests: ['src/fee.test.ts'], unknown: 'that text is not held' },
        ],
        unheld: ['src/fee.ts'],
      },
    } as unknown as Covering;
    expect(ranText(answer, NOW)).toEqual([
      'src/fee.ts is not on disk, so no text of it is held.',
      'src/pay.ts is the text the other test file named here ran over, at a time the record does not hold.',
      'Whether src/fee.test.ts ran over src/pay.ts as it is now, at a time the record does not hold, is not known: that text is not held.',
    ]);
  });
});
