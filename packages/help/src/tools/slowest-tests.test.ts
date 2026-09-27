import { describe, expect, it } from 'vitest';
import { formatSlowest, limitOf, scopeOf, SLOWEST, slowestTests, spent } from './slowest-tests.js';

const ANYWHERE = { unrecorded: [] };
const NO_CASES = { recording: '/cache/coverage.bin.cases.bin', unread: 'nothing is recorded there' };
const CASES_UNREAD =
  'Slowest recorded test cases: none read from /cache/coverage.bin.cases.bin, nothing is recorded there. ' +
  'A recorded test run writes it.';

describe('the slowest recorded test files, as printed', () => {
  it('lists each file with the duration its runner reported, and counts what it left out', () => {
    expect(formatSlowest([
      {
        suite: 'unit',
        recording: '/cache/suites/unit/coverage.bin',
        slowest: [
          { file: 'test/b.test.ts', duration: 1250 },
          { file: 'test/a.test.ts', duration: 40 },
        ],
        timed: 5,
        untimed: 2,
        scope: ANYWHERE,
        cases: {
          recording: '/cache/suites/unit/coverage.bin.cases.bin',
          slowest: [{ file: 'test/b.test.ts', name: 'reads > twice', duration: 900 }],
          timed: 8,
          untimed: 0,
          scope: ANYWHERE,
        },
      },
    ])).toBe([
      'Slowest recorded test files, suite unit, as their runner reported them, from /cache/suites/unit/coverage.bin:',
      '  1.3 s  test/b.test.ts',
      '  40 ms  test/a.test.ts',
      '2 of 5 timed file(s) shown; 2 recorded file(s) have no duration.',
      '',
      'Slowest recorded test cases, suite unit, as their runner reported them, from /cache/suites/unit/coverage.bin.cases.bin:',
      '  900 ms  test/b.test.ts  reads > twice',
      '1 of 8 timed case(s) shown.',
    ].join('\n'));
  });

  it('says the recording holds no durations rather than listing nothing', () => {
    expect(formatSlowest([
      { recording: '/cache/coverage.bin', slowest: [], timed: 0, untimed: 3, scope: ANYWHERE, cases: NO_CASES },
    ])).toBe(
      'Slowest recorded test files: none of the 3 file(s) in /cache/coverage.bin has a recorded duration. ' +
        `The next recorded run stores what its runner reports.\n\n${CASES_UNREAD}`,
    );
  });

  it('says where it looked when nothing is recorded', () => {
    expect(formatSlowest([{ recording: '/cache/coverage.bin', unread: 'nothing is recorded there', cases: NO_CASES }])).toBe(
      'Slowest recorded test files: none read from /cache/coverage.bin, nothing is recorded there. ' +
        `A recorded test run writes it.\n\n${CASES_UNREAD}`,
    );
  });

  it('names the scope it applied on the first line, and a `to` path with no row as unrecorded', () => {
    const answer = formatSlowest([{
      recording: '/cache/coverage.bin',
      slowest: [{ file: 'test/b.test.ts', duration: 40 }],
      timed: 1,
      untimed: 0,
      scope: { declared: 3, entered: 1, unrecorded: ['src/gone.ts'] },
      cases: NO_CASES,
    }], { from: ['test'], to: ['src/read.ts', 'src/gone.ts'] });

    expect(answer.split('\n').slice(0, 4)).toEqual([
      'Slowest recorded test files, under test, that entered src/read.ts or src/gone.ts, as their runner reported them, from /cache/coverage.bin:',
      '  40 ms  test/b.test.ts',
      '1 of 1 timed file(s) shown.',
      'Unrecorded: `src/gone.ts` has no row in /cache/coverage.bin, which says nothing about whether a test enters it.',
    ]);
  });

  it('says which half of an empty scope matched nothing, never an empty table', () => {
    const empty = (scope: { declared?: number; entered?: number; unrecorded: readonly string[] }, asked: object) =>
      formatSlowest([{ recording: '/r', slowest: [], timed: 0, untimed: 0, scope, cases: NO_CASES }], asked).split('\n')[0];

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

describe('how many rows it lists', () => {
  it('defaults when asked for no number, and takes one from the wire or the shell', () => {
    expect(limitOf({})).toBe(SLOWEST);
    expect(limitOf({ limit: 3 })).toBe(3);
    expect(limitOf({ limit: '7' })).toBe(7);
  });

  it('refuses a count that is not a whole number of rows', () => {
    for (const limit of [0, -1, 2.5, 'many', '']) {
      expect(() => limitOf({ limit })).toThrow(/takes a whole number of rows/);
    }
  });

  it('declares the limit it reads in the schema the CLI and the server publish', () => {
    expect(slowestTests.inputSchema['properties']).toHaveProperty('limit.type', 'integer');
    expect(slowestTests.inputSchema['properties']).toHaveProperty('from.type', 'array');
    expect(slowestTests.inputSchema['properties']).toHaveProperty('to.type', 'array');
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
