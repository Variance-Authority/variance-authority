import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordedAttempts } from './recorded-attempts.js';
import { encodeRecordedAttempts, type RecordedAttempt } from './test-selection/attempts-record.js';
import { withCaseSections } from './test-selection/case-record.js';
import { commitRunsFile } from './test-selection/commit-runs.js';
import { commitRunsText } from './test-selection/commit-runs-text.js';
import { encodeExecutionIndex } from './test-selection/execution-format.js';
import { encodeTestCoverage } from './test-selection/format.js';
import { testCoverageFile } from './test-selection/record-location.js';
import type { ExecutionIndex } from './test-selection/index.js';

/**
 * The reading `variance ask retried-tests` is made of: the cases a recorded
 * run entered more than once, and which of them ended differently from one
 * attempt to the next.
 */

const COMMIT = 'f'.repeat(40);
const LANDED = '2026-10-01T12:00:00.000Z';
const CASES: ExecutionIndex = {
  tests: [
    { id: 'a', file: 'test/a.test.ts', name: 'pays > twice', duration: 30, limit: 5_000 },
    { id: 'b', file: 'test/a.test.ts', name: 'never pays', duration: 20 },
    { id: 'c', file: 'test/b.test.ts', name: 'ran once', duration: 5, limit: 5_000 },
  ],
  modules: [],
};
const failed = (id: string, attempt: number): RecordedAttempt =>
  ({ case: id, attempt, ended: 'failed', duration: 12, message: 'expected 1 to be 2', frame: 'test/a.test.ts:7' });
const passed = (id: string, attempt: number): RecordedAttempt => ({ case: id, attempt, ended: 'passed', duration: 3 });

let root: string;

beforeEach(() => {
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', mkdtempSync(join(tmpdir(), 'va-attempts-cache-')));
  root = mkdtempSync(join(tmpdir(), 'va-attempts-'));
  execFileSync('git', ['init', '--quiet', root]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function record(attempts?: readonly RecordedAttempt[], cases: ExecutionIndex | null = CASES): string {
  const at = testCoverageFile(root);
  mkdirSync(dirname(at), { recursive: true });
  const bytes = encodeTestCoverage({ version: 3, instrumentation: 'fixture-instrumentation', commit: COMMIT, tests: [], modules: [] });
  writeFileSync(at, cases === null ? bytes : withCaseSections(bytes, {
    index: encodeExecutionIndex(cases),
    ...(attempts === undefined ? {} : { attempts: encodeRecordedAttempts(attempts) }),
  }));
  writeFileSync(commitRunsFile(at), commitRunsText({ commit: COMMIT, latest: LANDED, runs: 1, landings: [] }));
  return at;
}

describe('the recorded cases whose attempts ended differently', () => {
  it('lists a case that failed and then passed with each attempt, its limit and the record it was read from', () => {
    const at = record([failed('a', 1), passed('a', 2), failed('b', 1), failed('b', 2)]);

    expect(recordedAttempts(root, 10)).toEqual([{
      recording: at,
      origin: 'own',
      commit: COMMIT,
      landed: LANDED,
      differed: [{
        file: 'test/a.test.ts',
        name: 'pays > twice',
        limit: 5_000,
        attempts: [
          { attempt: 1, ended: 'failed', duration: 12, message: 'expected 1 to be 2', frame: 'test/a.test.ts:7' },
          { attempt: 2, ended: 'passed', duration: 3 },
        ],
      }],
      differing: 1,
      retried: 2,
      cases: 3,
    }]);
  });

  it('shows at most the number asked for, in path and then name order, and counts them all', () => {
    record([failed('b', 1), passed('b', 2), failed('a', 1), passed('a', 2)]);

    const [suite] = recordedAttempts(root, 1);

    expect(suite).toMatchObject({ differed: [{ name: 'never pays' }], differing: 2, retried: 2 });
  });

  it('answers with no case for a run that kept attempts and retried none', () => {
    record([]);

    expect(recordedAttempts(root, 10)[0]).toMatchObject({ differed: [], differing: 0, retried: 0, cases: 3 });
  });

  it('says attempts were not kept of a record written before they were, rather than that no case was retried', () => {
    const at = record(undefined);

    const [suite] = recordedAttempts(root, 10);

    expect(suite).toEqual({ recording: at, origin: 'own', commit: COMMIT, landed: LANDED, unkept: true });
  });

  it('says why of a record with no case index, and of a checkout that recorded nothing', () => {
    const at = record(undefined, null);
    expect(recordedAttempts(root, 10)).toEqual([{ recording: at, origin: 'own', unread: 'no run kept its cases there' }]);

    const empty = mkdtempSync(join(tmpdir(), 'va-attempts-none-'));
    execFileSync('git', ['init', '--quiet', empty]);
    expect(recordedAttempts(empty, 10)).toEqual([{ recording: testCoverageFile(empty), origin: 'own', unread: 'nothing is recorded there' }]);
  });

  it('refuses attempts that name a case the index does not hold', () => {
    record([failed('z', 1), passed('z', 2)]);

    expect(recordedAttempts(root, 10)[0]).toMatchObject({ unread: expect.stringContaining('names a case the record does not hold: z') });
  });
});
