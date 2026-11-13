import { describe, expect, it } from 'vitest';
import { jestAttempts } from './jest-attempts.js';

const failed = [{ attempt: 1, ended: 'failed' }, { attempt: 2, ended: 'passed' }];

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
