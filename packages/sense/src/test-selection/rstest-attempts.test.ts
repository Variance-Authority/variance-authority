import { describe, expect, it } from 'vitest';
import { rstestAttempts } from './rstest-attempts.js';

describe('the attempts Rstest reports', () => {
  it('are its retries and one more: the earlier ones failed with the error of their retry, the last one in the others\' spelling', () => {
    expect(rstestAttempts({ status: 'pass', retryCount: 1, retryErrors: [{ message: 'test timed out in 100ms', retryCount: 0 }] })).toEqual([
      { attempt: 1, ended: 'failed', message: 'test timed out in 100ms' },
      { attempt: 2, ended: 'passed' },
    ]);
    expect(rstestAttempts({
      status: 'fail', retryCount: 1, errors: [{ message: 'first', retryCount: 0 }, { message: 'second', retryCount: 1 }],
    })!.map((one) => [one.ended, one.message])).toEqual([['failed', 'first'], ['failed', 'second']]);
    expect(rstestAttempts({ status: 'skip', retryCount: 0 })).toEqual([{ attempt: 1, ended: 'skipped' }]);
  });

  it('are none when the retries it counts are not one run of them: `repeats` adds each repeat\'s to the count', () => {
    const first = { message: 'boom', retryCount: 0 };
    // `repeats: 1, retry: 1`, each repeat failing once: four runs, two retries counted, both errors from retry 0.
    expect(rstestAttempts({ status: 'pass', retryCount: 2, retryErrors: [first, first] })).toBeUndefined();
    // The first repeat failed once and passed, the second failed twice: the count runs past the last error's retry.
    expect(rstestAttempts({ status: 'fail', retryCount: 2, errors: [first, { message: 'boom', retryCount: 1 }] })).toBeUndefined();
  });

  it('are absent from a result that counts no retries', () => {
    expect(rstestAttempts({ status: 'pass' })).toBeUndefined();
  });
});
