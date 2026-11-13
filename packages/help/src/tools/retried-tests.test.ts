import type { RecordedAttempts } from '@variance-authority/sense';
import { describe, expect, it } from 'vitest';
import { formatRetried, retriedTests } from './retried-tests.js';

const NOW = Date.parse('2026-10-04T12:00:00Z');
const READ = { recording: '/cache/coverage.bin', origin: 'own', commit: 'f'.repeat(40), landed: '2026-10-01T12:00:00.000Z' } as const;
const RECORD = "Read this checkout's record at ffffffffffff, landed 3 days ago, /cache/coverage.bin.";
const printed = (suites: readonly RecordedAttempts[]): string => formatRetried(suites, NOW);

describe('the recorded cases whose attempts ended differently, as printed', () => {
  it('lists the case with each attempt as its runner said it ended, its limit, and the record it was read from', () => {
    expect(printed([{
      ...READ,
      differed: [{
        file: 'test/a.test.ts',
        name: 'pays > twice',
        limit: 5_000,
        attempts: [
          { attempt: 1, ended: 'failed', duration: 1250, message: 'expected 1 to be 2\n  at somewhere', frame: 'test/a.test.ts:7' },
          { attempt: 2, ended: 'passed', duration: 3 },
        ],
      }],
      differing: 1,
      retried: 3,
      cases: 40,
    }])).toBe([
      RECORD,
      '',
      'Ended differently across attempts:',
      '  test/a.test.ts  pays > twice  (limit 5.0 s)',
      '    attempt 1  failed  1.3 s  test/a.test.ts:7  expected 1 to be 2',
      '    attempt 2  passed  3 ms',
      '1 of 1 case(s) shown; 2 other retried case(s) ended the same way every attempt.',
    ].join('\n'));
  });

  it('names the suite, leaves out a limit and a duration nobody recorded, and counts what it did not show', () => {
    expect(printed([{
      ...READ,
      suite: 'unit',
      differed: [{ file: 'test/a.test.ts', name: 'pays', attempts: [{ attempt: 1, ended: 'timedOut' }, { attempt: 2, ended: 'passed' }] }],
      differing: 4,
      retried: 4,
      cases: 40,
    }])).toBe([
      "Suite unit read this checkout's record at ffffffffffff, landed 3 days ago, /cache/coverage.bin.",
      '',
      'Ended differently across attempts, suite unit:',
      '  test/a.test.ts  pays',
      '    attempt 1  timedOut',
      '    attempt 2  passed',
      '1 of 4 case(s) shown.',
    ].join('\n'));
  });

  it('says no case ran more than once, and says retried cases that ended the same way apart from that', () => {
    expect(printed([{ ...READ, differed: [], differing: 0, retried: 0, cases: 40 }]))
      .toBe(`${RECORD}\n\nEnded differently across attempts: none; no case of the 40 recorded ran more than once.`);
    expect(printed([{ ...READ, differed: [], differing: 0, retried: 2, cases: 40 }]))
      .toBe(`${RECORD}\n\nEnded differently across attempts: none; the 2 retried case(s) ended the same way every attempt.`);
  });

  it('says attempts were not kept of a record older than them, never that no case was retried', () => {
    expect(printed([{ ...READ, unkept: true }])).toBe(
      `${RECORD}\n\nEnded differently across attempts: attempts were not kept in /cache/coverage.bin, which a run older than them wrote, ` +
        'so it does not say whether a case was retried. The next recorded run keeps them.',
    );
  });

  it('says why a record was not read, each suite under its own name', () => {
    expect(printed([
      { suite: 'unit', recording: '/cache/suites/unit/coverage.bin', origin: 'own', unread: 'nothing is recorded there' },
      { suite: 'e2e', recording: '/cache/suites/e2e/coverage.bin', origin: 'own', unread: 'no run kept its cases there' },
    ])).toBe(
      'Ended differently across attempts, suite unit: none read from /cache/suites/unit/coverage.bin, nothing is recorded there.\n\n' +
        'Ended differently across attempts, suite e2e: none read from /cache/suites/e2e/coverage.bin, no run kept its cases there.',
    );
  });
});

describe('the question', () => {
  it('refuses to read a checkout its host did not name', () => {
    expect(() => retriedTests.run(undefined, {})).toThrow(/named no checkout/);
  });
});
