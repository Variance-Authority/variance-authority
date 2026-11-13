import { describe, expect, it } from 'vitest';
import { caseAttempts, triedAttempts } from './case-attempts.js';
import { finishedCase } from './case-durations.js';

const failed = [{ attempt: 1, ended: 'failed' }, { attempt: 2, ended: 'passed' }];

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
