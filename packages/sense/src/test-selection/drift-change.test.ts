import { describe, expect, it } from 'vitest';
import { driftChange, type DriftSide } from './drift-change.js';

const row = (test: string, file: string) => ({ file, test });
const side = (observed: string[], rows: { file: string; test: string }[], held: string[] = observed): DriftSide => ({
  rows,
  observed: new Set(observed),
  held: new Set(held),
});
const everywhere = () => true;

describe('where drift changed shape between the baseline and the pull request', () => {
  it('is nothing when both sides observed the same test files with the same rows', () => {
    const base = side(['t/a.test.ts'], [row('t/a.test.ts', 'src/map.ts')]);
    expect(driftChange(base, base, { present: everywhere })).toEqual({ compared: 1, grown: [], shrunk: [], first: [], removed: [], notCompared: [] });
  });

  it('names a row the baseline lacks as grown and a baseline row the run lacks as shrunk', () => {
    const base = side(['t/a.test.ts'], [row('t/a.test.ts', 'src/old.ts')]);
    const head = side(['t/a.test.ts'], [row('t/a.test.ts', 'src/new.ts')]);
    expect(driftChange(base, head, { present: everywhere })).toMatchObject({
      grown: [row('t/a.test.ts', 'src/new.ts')],
      shrunk: [row('t/a.test.ts', 'src/old.ts')],
    });
  });

  it('lists the drift of a test file the baseline does not hold apart, as its first', () => {
    const base = side([], []);
    const head = side(['t/new.test.ts'], [row('t/new.test.ts', 'src/map.ts')]);
    expect(driftChange(base, head, { present: everywhere })).toMatchObject({ compared: 0, grown: [], first: [row('t/new.test.ts', 'src/map.ts')] });
  });

  it('lists a baseline test file the tree no longer holds as removed, and never as shrunk', () => {
    const base = side(['t/gone.test.ts'], [row('t/gone.test.ts', 'src/map.ts')]);
    expect(driftChange(base, side([], []), { present: (file) => file !== 't/gone.test.ts' })).toMatchObject({
      shrunk: [],
      removed: ['t/gone.test.ts'],
    });
  });

  it('counts each test file it cannot compare under its reason, and compares none of its rows', () => {
    const base = side(['t/a.test.ts', 't/c.test.ts'], [row('t/a.test.ts', 'src/x.ts')], ['t/a.test.ts', 't/b.test.ts', 't/c.test.ts']);
    const head = side(['t/b.test.ts', 't/c.test.ts'], [row('t/b.test.ts', 'src/y.ts'), row('t/c.test.ts', 'src/z.ts')]);
    expect(driftChange(base, head, { present: everywhere, unread: new Map([['t/c.test.ts', 'src/gone.ts']]) })).toEqual({
      compared: 0,
      grown: [],
      shrunk: [],
      first: [],
      removed: [],
      notCompared: [
        { reason: 'not observed at the head', tests: ['t/a.test.ts'] },
        { reason: 'not observed at the baseline', tests: ['t/b.test.ts'] },
        { reason: 'no merge-base walk', tests: ['t/c.test.ts'] },
      ],
    });
  });

  it('counts a test file only the head holds, and did not observe whole, as not observed at the head', () => {
    const base = side(['t/a.test.ts'], []);
    const head = side(['t/a.test.ts'], [], ['t/a.test.ts', 't/new.test.ts']);
    expect(driftChange(base, head, { present: everywhere }).notCompared).toEqual([{ reason: 'not observed at the head', tests: ['t/new.test.ts'] }]);
  });
});
