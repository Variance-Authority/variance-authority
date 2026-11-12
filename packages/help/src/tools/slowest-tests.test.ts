import type { DurationScope, RecordedCaseDurations, RecordedDurations } from '@variance-authority/sense';
import { describe, expect, it } from 'vitest';
import { spellingOf } from '@variance-authority/mcp/tools';
import { formatSlowest, overOf, scopeOf, slowestTests, spent } from './slowest-tests.js';

const ANYWHERE = { unrecorded: [] };
const NO_CASES = { recording: '/cache/coverage.bin', unread: 'nothing is recorded there' };
const CASES_UNREAD = 'Slowest recorded test cases: none read from /cache/coverage.bin, nothing is recorded there.';
const NOW = Date.parse('2026-10-04T12:00:00Z');

const printed = (suites: readonly RecordedDurations[], scope: DurationScope = {}, over?: number): string =>
  formatSlowest(suites, scope, over, NOW);

/** A case index's reading, with nothing in it unless the test says. */
function read(cases: Partial<Extract<RecordedCaseDurations, { slowest: unknown }>>): RecordedCaseDurations {
  return {
    recording: '/cache/coverage.bin', slowest: [], closest: [], limited: 0, timed: 0, faster: 0, untimed: 0,
    scope: ANYWHERE, ...cases,
  };
}

/** A suite whose files are not the point of the test. */
function suite(cases: RecordedCaseDurations, record: object = {}): RecordedDurations {
  return {
    recording: '/cache/coverage.bin', origin: 'own', slowest: [], timed: 0, untimed: 0, scope: ANYWHERE, cases, ...record,
  };
}

describe('the slowest recorded test files, as printed', () => {
  it('lists each file with the duration its runner reported, and counts what it left out', () => {
    expect(printed([
      {
        suite: 'unit',
        recording: '/cache/suites/unit/coverage.bin',
        origin: 'own',
        slowest: [
          { file: 'test/b.test.ts', duration: 1250 },
          { file: 'test/a.test.ts', duration: 40 },
        ],
        timed: 5,
        untimed: 2,
        scope: ANYWHERE,
        cases: {
          recording: '/cache/suites/unit/coverage.bin',
          slowest: [{ file: 'test/b.test.ts', name: 'reads > twice', duration: 900 }],
          closest: [],
          limited: 0,
          timed: 8,
          faster: 0,
          untimed: 0,
          scope: ANYWHERE,
        },
      },
    ])).toBe([
      "Suite unit read this checkout's record, which names no commit, /cache/suites/unit/coverage.bin.",
      '',
      'Closest to their limit, suite unit: none of the 8 timed case(s) has a recorded limit, so they are listed by time alone.',
      '',
      'Slowest recorded test files, suite unit, as their runner timed them:',
      '  1.3 s  test/b.test.ts',
      '  40 ms  test/a.test.ts',
      '2 of 5 timed file(s) shown; 2 recorded file(s) have no duration.',
      '',
      'Slowest recorded test cases, suite unit, as their runner timed them:',
      '  900 ms  test/b.test.ts  reads > twice',
      '1 of 8 timed case(s) shown.',
    ].join('\n'));
  });

  it('says the recording holds no durations rather than listing nothing', () => {
    expect(printed([
      { recording: '/cache/coverage.bin', origin: 'own', slowest: [], timed: 0, untimed: 3, scope: ANYWHERE, cases: NO_CASES },
    ])).toBe(
      "Read this checkout's record, which names no commit, /cache/coverage.bin.\n\n" +
        'Slowest recorded test files: none of the 3 file(s) in /cache/coverage.bin has a recorded duration. ' +
        `The next recorded run stores what its runner reports.\n\n${CASES_UNREAD}`,
    );
  });

  it('says where it looked when nothing is recorded', () => {
    expect(printed([{ recording: '/cache/coverage.bin', origin: 'own', unread: 'nothing is recorded there', cases: NO_CASES }])).toBe(
      `Slowest recorded test files: none read from /cache/coverage.bin, nothing is recorded there.\n\n${CASES_UNREAD}`,
    );
  });

  it('names the scope it applied on the first line, and a `to` path with no row as unrecorded', () => {
    const answer = printed([{
      recording: '/cache/coverage.bin',
      origin: 'own',
      slowest: [{ file: 'test/b.test.ts', duration: 40 }],
      timed: 1,
      untimed: 0,
      scope: { declared: 3, entered: 1, unrecorded: ['src/gone.ts'] },
      cases: NO_CASES,
    }], { from: ['test'], to: ['src/read.ts', 'src/gone.ts'] });

    expect(answer.split('\n').slice(2, 6)).toEqual([
      'Slowest recorded test files, under test, that entered src/read.ts or src/gone.ts, as their runner timed them:',
      '  40 ms  test/b.test.ts',
      '1 of 1 timed file(s) shown.',
      'Unrecorded: `src/gone.ts` has no row in /cache/coverage.bin, which says nothing about whether a test enters it.',
    ]);
  });

  it('says which half of an empty scope matched nothing, never an empty table', () => {
    const empty = (scope: { declared?: number; entered?: number; unrecorded: readonly string[] }, asked: object) =>
      printed([{ recording: '/r', origin: 'own', slowest: [], timed: 0, untimed: 0, scope, cases: NO_CASES }], asked).split('\n')[2];

    expect(empty({ declared: 0, unrecorded: [] }, { from: ['lib'] }))
      .toBe('Slowest recorded test files, under lib: no recorded file in /r is declared under lib.');
    expect(empty({ entered: 0, unrecorded: [] }, { to: ['src/a.ts'] }))
      .toBe('Slowest recorded test files, that entered src/a.ts: no recorded file in /r entered src/a.ts.');
    expect(empty({ declared: 2, entered: 3, unrecorded: [] }, { from: ['lib'], to: ['src/a.ts'] }))
      .toBe('Slowest recorded test files, under lib, that entered src/a.ts: no recorded file under lib entered src/a.ts, in /r.');
    expect(empty({ entered: 0, unrecorded: ['src/a.ts'] }, { to: ['src/a.ts'] }))
      .toBe('Slowest recorded test files, that entered src/a.ts: /r holds no row at src/a.ts, so it cannot say which files entered it.');
  });

  it('prints milliseconds under a second and tenths of a second above', () => {
    expect([0, 999, 1000, 12_345].map(spent)).toEqual(['0 ms', '999 ms', '1.0 s', '12.3 s']);
  });
});

describe('the record an answer read', () => {
  const said = (record: object): string | undefined =>
    printed([suite(NO_CASES, record)]).split('\n')[0];

  it('says whose record it is, at which commit, and when its latest run landed', () => {
    expect(said({ origin: 'mainline', commit: 'a'.repeat(40), landed: '2026-10-01T12:00:00Z' }))
      .toBe('Read the fetched mainline record at aaaaaaaaaaaa, landed 3 days ago, /cache/coverage.bin.');
    expect(said({ origin: 'primary', commit: 'b'.repeat(40), landed: '2026-10-04T11:30:00Z' }))
      .toBe("Read the primary checkout's record at bbbbbbbbbbbb, landed 30 minutes ago, /cache/coverage.bin.");
  });

  it('says so when the record holds no landing', () => {
    expect(said({ commit: 'c'.repeat(40) }))
      .toBe("Read this checkout's record at cccccccccccc, landed at a time the record does not hold, /cache/coverage.bin.");
  });
});

describe('the cases closest to their limit', () => {
  const closest = [
    { file: 'test/a.test.ts', name: 'nearly out', duration: 4_900, limit: 5_000 },
    { file: 'slow/b.test.ts', name: 'imports the world', duration: 40_000, limit: 60_000 },
  ];

  it('lists each as its run and its limit, before the files, and counts the cases with no limit', () => {
    const answer = printed([suite(read({ closest, limited: 2, timed: 3, slowest: closest }))]).split('\n');

    expect(answer.slice(2, 7)).toEqual([
      'Closest to their limit, each as run and limit:',
      '    4.9 s of 5.0 s  test/a.test.ts  nearly out',
      '  40.0 s of 60.0 s  slow/b.test.ts  imports the world',
      '2 of 2 limited case(s) shown; 1 timed case(s) have no recorded limit.',
      '',
    ]);
  });

  it('says a time asked for that tenths would move in milliseconds', () => {
    expect(printed([suite(read({ faster: 2 }))], {}, 4_960)).toContain('ran at least 4960 ms');
  });

  it('prints milliseconds where tenths would read a run as its whole limit', () => {
    const close = { file: 'test/a.test.ts', name: 'nearly', duration: 4_960, limit: 5_000 };

    expect(printed([suite(read({ closest: [close], limited: 1, timed: 1 }))])).toContain('4960 ms of 5000 ms');
  });

  it('names the absence on a record with no limits, and still lists the cases by time', () => {
    const slowest = [{ file: 'test/a.test.ts', name: 'old', duration: 900 }];

    const answer = printed([suite(read({ slowest, timed: 1 }))]);

    expect(answer).toContain('Closest to their limit: none of the 1 timed case(s) has a recorded limit, so they are listed by time alone.');
    expect(answer).toContain('  900 ms  test/a.test.ts  old');
  });
});

describe('cases over a time', () => {
  it('leaves the files out, says the time in each heading and counts what ran faster', () => {
    const slowest = [{ file: 'test/a.test.ts', name: 'slow', duration: 3_500, limit: 5_000 }];

    expect(printed([suite(read({ slowest, closest: slowest, limited: 1, timed: 1, faster: 4, untimed: 2 }))], { from: ['test'] }, 3_000).split('\n').slice(2)).toEqual([
      'Closest to their limit, under test, at least 3.0 s, each as run and limit:',
      '  3.5 s of 5.0 s  test/a.test.ts  slow',
      '1 of 1 limited case(s) shown.',
      '',
      'Slowest recorded test cases, under test, at least 3.0 s, as their runner timed them:',
      '  3.5 s  test/a.test.ts  slow',
      '1 of 1 timed case(s) shown; 4 ran faster; 2 recorded case(s) have no duration.',
    ]);
  });

  it('says none ran that long, rather than that the scope matched nothing', () => {
    expect(printed([suite(read({ faster: 4 }))], {}, 3_000).split('\n').slice(2)).toEqual([
      'Slowest recorded test cases, at least 3.0 s: none of the 4 timed case(s) ran at least 3.0 s.',
    ]);
  });

  it('reads seconds and milliseconds, and refuses anything else as the surface asked takes it', () => {
    const wire = spellingOf(undefined);
    expect(overOf({}, wire)).toBeUndefined();
    expect(['3s', '1.5s', '500ms'].map((over) => overOf({ over }, wire))).toEqual([3_000, 1_500, 500]);
    expect(() => overOf({ over: 'soon' }, wire)).toThrow('`over` takes a time such as `3s` or `500ms`; it was given `soon`.');
    expect(() => overOf({ over: '3' }, spellingOf({ shell: 'variance ask' })))
      .toThrow('`--over` takes a time such as `3s` or `500ms`; it was given `3`.');
  });
});

describe('how many rows it lists', () => {
  it('refuses a count that is not a whole number of rows, before it reads anything', () => {
    expect(() => slowestTests.run(undefined, { limit: 0 }, {})).toThrow(/takes a whole number of rows/);
  });

  it('declares the limit it reads in the schema the CLI and the server publish', () => {
    expect(slowestTests.inputSchema['properties']).toHaveProperty('limit.type', 'integer');
    expect(slowestTests.inputSchema['properties']).toHaveProperty('from.type', 'array');
    expect(slowestTests.inputSchema['properties']).toHaveProperty('to.type', 'array');
    expect(slowestTests.inputSchema['properties']).toHaveProperty('over.type', 'string');
  });
});

describe('where it looks', () => {
  it('reads a path or a list of them, and drops a leading `./`', () => {
    expect(scopeOf({})).toEqual({});
    expect(scopeOf({ from: './test', to: ['src/a.ts', ' ', 'src/b'] })).toEqual({ from: ['test'], to: ['src/a.ts', 'src/b'] });
  });

  it('refuses when the host named no checkout, rather than reading the working directory', () => {
    expect(() => slowestTests.run(undefined, {}, {})).toThrow(/named no checkout/);
  });
});
