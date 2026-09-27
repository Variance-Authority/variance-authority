import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recordedDurations } from './recorded-durations.js';
import { encodeTestCoverage } from './test-selection/format.js';
import { testCoverageFile } from './test-selection/record-location.js';
import type { TestCoverage } from './test-selection/index.js';

/**
 * The reading `variance ask slowest-tests` is made of: the durations a
 * recording holds, over a checkout that published one and over one that did
 * not, which is answered with where it looked.
 */

function coverage(tests: readonly (readonly [string, number | undefined])[]): TestCoverage {
  return {
    version: 3,
    instrumentation: 'fixture-instrumentation',
    tests: tests.map(([file, duration]) => ({
      file,
      complete: true,
      preconditions: [],
      ...(duration === undefined ? {} : { duration }),
    })),
    modules: [],
  };
}

let root: string;

beforeEach(() => {
  process.env['XDG_CACHE_HOME'] = mkdtempSync(join(tmpdir(), 'va-durations-cache-'));
  root = mkdtempSync(join(tmpdir(), 'va-durations-'));
  execFileSync('git', ['init', '--quiet', root]);
});

afterEach(() => {
  delete process.env['XDG_CACHE_HOME'];
});

function record(snapshot: TestCoverage): string {
  const at = testCoverageFile(root);
  mkdirSync(dirname(at), { recursive: true });
  writeFileSync(at, encodeTestCoverage(snapshot));
  return at;
}

describe('the slowest recorded test files', () => {
  it('lists the slowest first, breaks ties by path, and counts the untimed apart', () => {
    const at = record(coverage([
      ['test/a.test.ts', 40],
      ['test/b.test.ts', 900],
      ['test/c.test.ts', undefined],
      ['test/d.test.ts', 40],
      ['test/e.test.ts', 0],
    ]));

    expect(recordedDurations(root, 3)).toEqual([
      {
        recording: at,
        slowest: [
          { file: 'test/b.test.ts', duration: 900 },
          { file: 'test/a.test.ts', duration: 40 },
          { file: 'test/d.test.ts', duration: 40 },
        ],
        timed: 4,
        untimed: 1,
      },
    ]);
  });

  it('says where it looked when nothing is recorded', () => {
    expect(recordedDurations(root, 3)).toEqual([
      { recording: testCoverageFile(root), unread: 'nothing is recorded there' },
    ]);
  });
});
