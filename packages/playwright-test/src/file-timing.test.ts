import { describe, expect, it } from 'vitest';
import { timedSubjects } from './file-timing.js';

const journal = { instrumentation: 'x', modules: [] };

describe('timedSubjects', () => {
  it('gives a file only a head reported on the time the runner measured for it', () => {
    const [head] = timedSubjects([{ owner: 'a.spec.ts', journal }], new Map([['a.spec.ts', 83]]), new Map([['a.spec.ts', 1000]]), new Map([['a.spec.ts', 2]]));
    expect(head).toMatchObject({ owner: 'a.spec.ts', duration: 83, start: 1000, lane: 2 });
  });

  it('leaves a subject that already carries its time, and a file nobody timed, as they are', () => {
    const timed = { owner: 'a.spec.ts', journal, duration: 5, start: 7 };
    const other = { owner: 'b.spec.ts', journal };
    expect(timedSubjects([timed, other], new Map([['a.spec.ts', 83]]), new Map(), new Map())).toEqual([timed, other]);
  });
});
