import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commitRunsFile, encodeExecutionIndex, testCoverageFile, withCaseSections, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../bin.fixture.js';
import { main } from '../bin.js';
import { EXIT_CLEAN } from '../exit.js';
// Sense publishes the readers of these two and not their writers, which only
// a recording run calls, so this writes a record the way that run does.
import { encodeRecordedAttempts } from '../../../sense/src/test-selection/attempts-record.js';
import { commitRunsText } from '../../../sense/src/test-selection/commit-runs-text.js';

/**
 * `variance ask retried-tests`, through the command a person types: a case
 * that failed and then passed is listed with both attempts and the record it
 * was read from, and a record older than attempts is told apart from a run
 * that retried nothing.
 */

const cwd = process.cwd();
const COMMIT = 'f'.repeat(40);

beforeEach(() => {
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', mkdtempSync(join(tmpdir(), 'va-retried-cache-')));
});

afterEach(() => {
  process.chdir(cwd);
  vi.unstubAllEnvs();
});

async function recorded(attempts: Parameters<typeof encodeRecordedAttempts>[0] | undefined): Promise<string> {
  // The cache is keyed by the path the checkout is at, which a temporary directory's name is not on macOS.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-retried-')));
  execFileSync('git', ['init', '--quiet', '--initial-branch', 'main'], { cwd: root, stdio: 'pipe' });
  process.chdir(root);
  const at = testCoverageFile(root);
  await writeTestCoverage(at, { version: 3, instrumentation: 'fixture-instrumentation', commit: COMMIT, tests: [], modules: [] });
  writeFileSync(at, withCaseSections(readFileSync(at), {
    index: encodeExecutionIndex({
      tests: [
        { id: 'a', file: 'test/pay.test.ts', name: 'checkout > pays', duration: 40, limit: 5_000 },
        { id: 'b', file: 'test/pay.test.ts', name: 'checkout > refunds', duration: 9, limit: 5_000 },
      ],
      modules: [],
    }),
    ...(attempts === undefined ? {} : { attempts: encodeRecordedAttempts(attempts) }),
  }));
  writeFileSync(commitRunsFile(at), commitRunsText({ commit: COMMIT, latest: new Date().toISOString(), runs: 1, landings: [] }));
  return at;
}

async function run(argv: readonly string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const code = await main(argv, { out: (text) => { out += text; }, err: (text) => { err += text; } });
  return { code, out, err };
}

describe('variance ask retried-tests', () => {
  it('lists a case that failed and then passed with both attempts, its limit, and the record\'s origin, commit and age', async () => {
    const at = await recorded([
      { case: 'a', attempt: 1, ended: 'failed', duration: 31, message: 'expected 1 to be 2', frame: 'test/pay.test.ts:12' },
      { case: 'a', attempt: 2, ended: 'passed', duration: 8 },
    ]);

    expect(await run(['ask', 'retried-tests'])).toEqual({
      code: EXIT_CLEAN,
      err: '',
      out: [
        `Read this checkout's record at ffffffffffff, landed under a minute ago, ${at}.`,
        '',
        'Ended differently across attempts:',
        '  test/pay.test.ts  checkout > pays  (limit 5.0 s)',
        '    attempt 1  failed  31 ms  test/pay.test.ts:12  expected 1 to be 2',
        '    attempt 2  passed  8 ms',
        '1 of 1 case(s) shown.',
        '',
      ].join('\n'),
    });
  });

  it('tells a record whose run kept no attempts from a run that retried no case', async () => {
    const old = await recorded(undefined);
    expect((await run(['ask', 'retried-tests'])).out).toContain(
      `Ended differently across attempts: attempts were not kept in ${old}, so it does not say whether a case was retried.`,
    );

    await recorded([]);
    expect((await run(['ask', 'retried-tests'])).out).toContain(
      'Ended differently across attempts: none; no case of the 2 recorded ran more than once.',
    );
  });
});
