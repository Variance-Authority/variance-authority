import { describe, expect, it } from 'vitest';
import { formatSlowest, limitOf, SLOWEST, slowestTests, spent } from './slowest-tests.js';

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
      },
    ])).toBe([
      'Slowest recorded test files, suite unit, as their runner reported them, from /cache/suites/unit/coverage.bin:',
      '  1.3 s  test/b.test.ts',
      '  40 ms  test/a.test.ts',
      '2 of 5 timed file(s) shown; 2 recorded file(s) have no duration.',
    ].join('\n'));
  });

  it('says the recording holds no durations rather than listing nothing', () => {
    expect(formatSlowest([{ recording: '/cache/coverage.bin', slowest: [], timed: 0, untimed: 3 }])).toBe(
      'Slowest recorded test files: none of the 3 file(s) in /cache/coverage.bin has a recorded duration. ' +
        'The next recorded run stores what its runner reports.',
    );
  });

  it('says where it looked when nothing is recorded', () => {
    expect(formatSlowest([{ recording: '/cache/coverage.bin', unread: 'nothing is recorded there' }])).toBe(
      'Slowest recorded test files: none read from /cache/coverage.bin, nothing is recorded there. ' +
        'A recorded test run writes it.',
    );
  });

  it('prints milliseconds under a second and tenths of a second above', () => {
    expect([0, 999, 1000, 12_345].map(spent)).toEqual(['0 ms', '999 ms', '1.0 s', '12.3 s']);
  });
});

describe('how many files it lists', () => {
  it('defaults when asked for no number, and takes one from the wire or the shell', () => {
    expect(limitOf({})).toBe(SLOWEST);
    expect(limitOf({ limit: 3 })).toBe(3);
    expect(limitOf({ limit: '7' })).toBe(7);
  });

  it('refuses a count that is not a whole number of files', () => {
    for (const limit of [0, -1, 2.5, 'many', '']) {
      expect(() => limitOf({ limit })).toThrow(/takes a whole number of files/);
    }
  });

  it('declares the limit it reads in the schema the CLI and the server publish', () => {
    expect(slowestTests.inputSchema['properties']).toHaveProperty('limit.type', 'integer');
  });
});
