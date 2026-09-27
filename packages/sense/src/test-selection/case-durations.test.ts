import { describe, expect, it } from 'vitest';
import { caseDurations, finishedCase, taskCases, UNTIMED } from './case-durations.js';

const root = '/repo';
const file = '/repo/test/a.test.ts';
const path = 'test/a.test.ts';

describe('each case\'s duration, joined to the case the scope recorded', () => {
  it('matches by the runner\'s id where both sides carry one, and by name otherwise', () => {
    const durations = caseDurations([{
      filepath: file,
      cases: [{ name: 'reads', id: 'x1', duration: 30 }, { name: 'writes', duration: 7 }],
    }], root);

    expect(durations(path, 'renamed on the scope side', 'x1')).toBe(30);
    expect(durations(path, 'writes', 'no such id')).toBe(7);
    expect(durations(path, 'never ran', 'no such id')).toBeUndefined();
  });

  it('sums a case two projects both ran, and leaves it untimed when either did not time it', () => {
    const twice = (second: number | undefined) => caseDurations([
      { filepath: file, cases: [{ name: 'reads', duration: 30 }] },
      { filepath: file, cases: [finishedCase('reads', undefined, second)] },
    ], root);

    expect(twice(12)(path, 'reads', 'id')).toBe(42);
    expect(twice(undefined)(path, 'reads', 'id')).toBeUndefined();
  });

  it('leaves untimed a name one file declares twice, since it cannot say which of the two it is', () => {
    const durations = caseDurations([{
      filepath: file,
      cases: [{ name: 'reads', duration: 30 }, { name: 'reads', duration: 5 }],
    }], root);

    expect(durations(path, 'reads', 'id')).toBeUndefined();
  });

  it('leaves untimed every case of a file announced with no cases, even when another project timed it', () => {
    const durations = caseDurations([
      { filepath: file, cases: [{ name: 'reads', duration: 30 }] },
      { filepath: file },
    ], root);

    expect(durations(path, 'reads', 'id')).toBeUndefined();
    expect(UNTIMED(path, 'reads', 'id')).toBeUndefined();
  });

  it('keeps no duration a runner could not have meant', () => {
    expect([-1, Number.NaN, 'soon', undefined].map((said) => 'duration' in finishedCase('a', undefined, said)))
      .toEqual([false, false, false, false]);
  });

  it('names a Vitest task tree\'s leaves by the suites between, as the case scope does', () => {
    expect(taskCases({
      tasks: [
        { name: 'reads', tasks: [{ name: 'twice', id: 't1', result: { duration: 4 } }] },
        { name: 'writes', id: 't2' },
      ],
    } as never)).toEqual({
      cases: [{ name: 'reads > twice', id: 't1', duration: 4 }, { name: 'writes', id: 't2' }],
    });
  });
});
