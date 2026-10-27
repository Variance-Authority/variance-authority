import { describe, expect, it } from 'vitest';
import { ranText } from './covering-ran.js';

/** How `covering` words where and when the test files it names last ran. */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const NOW = Date.parse('2026-05-04T12:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

describe('ranText', () => {
  it('gives a range when the test files last ran at different commits, and counts those that ran over another text', () => {
    const said = ranText({
      stands: [
        { commit: A, tests: ['src/pay.test.ts'], committedAt: iso(NOW - 9 * HOUR), otherText: ['src/pay.ts'] },
        { commit: B, tests: ['src/fee.test.ts', 'src/tax.test.ts'], landed: { first: iso(NOW - 6 * MINUTE), latest: iso(NOW - 6 * MINUTE), runs: 1 } },
      ],
    }, B, NOW);

    expect(said).toEqual([
      'The 3 test files named here last ran at 2 commits, from aaaaaaaaaaaa, a commit made 9 hours ago, to bbbbbbbbbbbb, in a run that landed 6 minutes ago; 1 of them ran over another text of src/pay.ts, which changed between where they ran and bbbbbbbbbbbb.',
    ]);
  });

  it('names every other text a stand ran over', () => {
    const said = ranText({
      stands: [{ commit: A, tests: ['src/pay.test.ts'], committedAt: iso(NOW - 2 * HOUR), otherText: ['src/fee.ts', 'src/pay.ts', 'src/tax.ts'] }],
    }, B, NOW);

    expect(said).toEqual([
      'The test file named here last ran at aaaaaaaaaaaa, a commit made 2 hours ago, over other texts of src/fee.ts, src/pay.ts and src/tax.ts, which changed between that commit and bbbbbbbbbbbb.',
    ]);
  });

  it('says why git gave no time for a commit', () => {
    const said = ranText({ stands: [{ commit: A, tests: ['src/pay.test.ts'], unread: 'fatal: not a git repository' }] }, A, NOW);

    expect(said).toEqual(['The test file named here last ran at aaaaaaaaaaaa, a commit git could not date (fatal: not a git repository).']);
  });

  it('says the landing time once when every run at the commit landed at it', () => {
    const at = iso(NOW - 3 * HOUR);
    const said = ranText({ stands: [{ commit: A, tests: ['src/pay.test.ts'], landed: { first: at, latest: at, runs: 2 } }] }, A, NOW);

    expect(said).toEqual(['The test file named here last ran at aaaaaaaaaaaa, in one of the 2 runs at it, which landed 3 hours ago.']);
  });

  it('says nothing when the answer names no test file', () => {
    expect(ranText(undefined, A, NOW)).toEqual([]);
  });
});
