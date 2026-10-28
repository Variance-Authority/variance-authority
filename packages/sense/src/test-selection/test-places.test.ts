import { describe, expect, it } from 'vitest';
import type { CommitRuns } from './commit-runs.js';
import { testPlaces } from './test-places.js';

/**
 * Where a test last ran is read from the runs record alone, and the time its
 * runs landed is read with it: the record carries it, so nothing works it out
 * again from git.
 */

const runs: CommitRuns = {
  commit: 'H',
  over: 'P',
  first: '2026-01-03T00:00:00.000Z',
  latest: '2026-01-04T00:00:00.000Z',
  runs: 2,
  files: ['a.test.ts'],
  // The second run finished the file again, so the first left no landing.
  landings: [{ files: ['a.test.ts'], first: '2026-01-04T00:00:00.000Z', latest: '2026-01-04T00:00:00.000Z', runs: 1, texts: {} }],
  standing: [
    { commit: 'Q', files: ['b.test.ts'], first: '2026-01-01T00:00:00.000Z', latest: '2026-01-02T00:00:00.000Z', runs: 1, texts: { 'src/a.ts': 'digest:edited' } },
    { commit: 'R', files: ['c.test.ts'] },
    { commit: 'S', files: ['d.test.ts'], assumed: true },
  ],
};

describe('a test is placed where the runs record says it last ran, with the time its runs landed', () => {
  it('reads the time and texts of the runs at the snapshot commit, of a carried stand, and none where the record holds none', () => {
    const { places, assumed } = testPlaces({ commit: 'H', runs, tests: ['a.test.ts', 'b.test.ts', 'c.test.ts', 'd.test.ts', 'e.test.ts'] });
    expect(Object.fromEntries(places)).toEqual({
      'a.test.ts': { commit: 'H', first: runs.latest, latest: runs.latest, runs: 1, texts: {} },
      'b.test.ts': { commit: 'Q', first: '2026-01-01T00:00:00.000Z', latest: '2026-01-02T00:00:00.000Z', runs: 1, texts: { 'src/a.ts': 'digest:edited' } },
      'c.test.ts': { commit: 'R' },
      'd.test.ts': { commit: 'S', assumed: true },
      'e.test.ts': { commit: 'P', assumed: true },
    });
    expect(assumed).toBe('the runs record beside the snapshot does not say where 2 test(s) last ran, so they are read from the commits they were assumed at, S, P');
  });

  it('places a test of a seeded record by the base\'s landing as it is, one run that landed', () => {
    const { places } = testPlaces({ commit: 'H', runs: { ...runs, runs: 0 }, tests: ['a.test.ts'] });
    expect(places.get('a.test.ts')).toEqual({ commit: 'H', first: runs.latest, latest: runs.latest, runs: 1, texts: {} });
  });

  it('holds no time for a record of another snapshot, and says so', () => {
    const { places, assumed } = testPlaces({ commit: 'X', runs, tests: ['a.test.ts'] });
    expect(places.get('a.test.ts')).toEqual({ commit: 'X', assumed: true });
    expect(assumed).toBe("the runs record beside the snapshot is H's, not X's, so every test is read as though it last ran at X");
  });

  it('places the test files a run outside a checkout finished by its landing, with its time and at no commit', () => {
    const at = '2026-01-03T00:00:00.000Z';
    const outside: CommitRuns = { first: at, latest: at, runs: 1, files: ['a.test.ts'], landings: [{ files: ['a.test.ts'], first: at, latest: at, runs: 1 }] };
    const { places, assumed } = testPlaces({ commit: undefined, runs: outside, tests: ['a.test.ts', 'b.test.ts'] });

    expect(places.get('a.test.ts')).toEqual({ first: at, latest: at, runs: 1 });
    expect(places.get('b.test.ts')).toEqual({ assumed: true });
    expect(assumed).toBe('the runs record beside the snapshot does not say where 1 test(s) last ran, so they are read from where the snapshot was recorded');
  });

  it('reads every test from where the snapshot was recorded when it names no commit and nothing else says', () => {
    expect(testPlaces({ commit: undefined, runs: undefined, tests: ['a.test.ts'] })).toEqual({
      places: new Map([['a.test.ts', { assumed: true }]]),
      assumed: 'no runs record lies beside the snapshot, so every test is read as though it last ran where the snapshot was recorded',
    });
    expect(testPlaces({ commit: undefined, runs, tests: ['a.test.ts'] }).assumed)
      .toBe("the runs record beside the snapshot is H's, and the snapshot names no commit, so every test is read as though it last ran where the snapshot was recorded");
  });
});
