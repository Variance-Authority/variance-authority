import { describe, expect, it } from 'vitest';
import { caseAttempts, jestAttempts, rstestAttempts, triedAttempts, vitestAttempts } from './case-attempts.js';
import { finishedCase } from './case-durations.js';

const failed = [{ attempt: 1, ended: 'failed' }, { attempt: 2, ended: 'passed' }];

describe('the attempts Vitest reports', () => {
  it('are each its own state, first error and duration, a skip on the retry included', () => {
    expect(vitestAttempts([
      { state: 'failed', errors: [{ message: 'Test timed out in 100ms.', stack: 'Error\n    at /repo/a.test.ts:3:1' }, { message: 'second' }], duration: 104.6 },
      { state: 'skipped', errors: undefined, duration: 0 },
    ])).toEqual([
      { attempt: 1, ended: 'failed', duration: 105, message: 'Test timed out in 100ms.', stack: 'Error\n    at /repo/a.test.ts:3:1' },
      { attempt: 2, ended: 'skipped', duration: 0 },
    ]);
  });

  it('are absent from a Vitest whose test case counts none', () => {
    expect(vitestAttempts(undefined)).toBeUndefined();
  });
});

describe('the attempts Jest reports', () => {
  it('are its invocations: the earlier ones failed and untimed, the last one as the case ended', () => {
    expect(jestAttempts({ status: 'passed', invocations: 2, failureMessages: [] })).toEqual(failed);
    expect(jestAttempts({ status: 'failed', invocations: 2, failureMessages: ['Error: boom\n    at run (/repo/a.test.ts:3:1)'] })).toEqual([
      { attempt: 1, ended: 'failed' },
      { attempt: 2, ended: 'failed', message: 'Error: boom', stack: 'Error: boom\n    at run (/repo/a.test.ts:3:1)' },
    ]);
  });

  it('name what an earlier one failed with only when Jest kept one reason for each', () => {
    const reason = 'Error: thrown: "Exceeded timeout of 100 ms for a test."\n    at /repo/a.test.ts:3:1';
    expect(jestAttempts({ status: 'passed', invocations: 2, retryReasons: [reason] })![0]).toEqual({
      attempt: 1, ended: 'failed', message: 'Error: thrown: "Exceeded timeout of 100 ms for a test."', stack: reason,
    });
    expect(jestAttempts({ status: 'passed', invocations: 3, retryReasons: [reason, reason, reason] })!.map((one) => one.message))
      .toEqual([undefined, undefined, undefined]);
  });

  it('are absent from a result that counts no invocations', () => {
    expect(jestAttempts({ status: 'passed' })).toBeUndefined();
  });
});

describe('the attempts Rstest reports', () => {
  it('are its retries and one more: the earlier ones failed with the error of their retry, the last one in the others\' spelling', () => {
    expect(rstestAttempts({ status: 'pass', retryCount: 1, retryErrors: [{ message: 'test timed out in 100ms', retryCount: 0 }] })).toEqual([
      { attempt: 1, ended: 'failed', message: 'test timed out in 100ms' },
      { attempt: 2, ended: 'passed' },
    ]);
    expect(rstestAttempts({
      status: 'fail', retryCount: 1, errors: [{ message: 'first', retryCount: 0 }, { message: 'second', retryCount: 1 }],
    })!.map((one) => [one.ended, one.message])).toEqual([['failed', 'first'], ['failed', 'second']]);
    expect(rstestAttempts({ status: 'skip', retryCount: 0 })).toEqual([{ attempt: 1, ended: 'skip' }]);
  });

  it('are absent from a result that counts no retries', () => {
    expect(rstestAttempts({ status: 'pass' })).toBeUndefined();
  });
});

describe('the attempts of a run\'s cases', () => {
  const file = (...cases: ReturnType<typeof finishedCase>[]) => [{ filepath: '/repo/a.test.ts', cases }];

  it('are joined by the runner\'s id, and by a name the file declares once', () => {
    const tried = caseAttempts(file(finishedCase('flaky', 'id-1', 1, undefined, failed), finishedCase('other', undefined, 1, undefined, failed)), '/repo')!;
    expect(tried('a.test.ts', 'renamed', 'id-1')).toBe(failed);
    expect(tried('a.test.ts', 'other', 'other')).toBe(failed);
    expect(tried('b.test.ts', 'other', 'other')).toBeUndefined();
  });

  it('are nobody\'s under a name one file declares twice: its two declarations are not attempts 1 and 2', () => {
    const once = [{ attempt: 1, ended: 'failed' }];
    const tried = caseAttempts(file(finishedCase('twin', undefined, 1, undefined, once), finishedCase('twin', undefined, 1, undefined, failed)), '/repo')!;
    expect(tried('a.test.ts', 'twin', 'twin')).toBeUndefined();
  });

  it('are not kept by a run whose report counted none', () => {
    expect(caseAttempts(file(finishedCase('plain', undefined, 1)), '/repo')).toBeUndefined();
    expect(triedAttempts([{ file: 'a.test.ts', name: 'plain', id: 'plain' }], new Map(), undefined, '/repo')).toBeUndefined();
  });

  it('become rows only for a case the run recorded and the runner tried again', () => {
    const tried = caseAttempts(file(finishedCase('flaky', undefined, 1, undefined, failed), finishedCase('once', undefined, 1, undefined, [{ attempt: 1, ended: 'passed' }])), '/repo');
    const cases = [{ file: 'a.test.ts', name: 'flaky', id: 'flaky' }, { file: 'a.test.ts', name: 'once', id: 'once' }];
    const ids = new Map([['a.test.ts\0flaky\0flaky', 'a.test.ts > flaky'], ['a.test.ts\0once\0once', 'a.test.ts > once']]);
    expect(triedAttempts(cases, ids, tried, '/repo').map((row) => `${row.case} ${row.attempt} ${row.ended}`))
      .toEqual(['a.test.ts > flaky 1 failed', 'a.test.ts > flaky 2 passed']);
  });
});
