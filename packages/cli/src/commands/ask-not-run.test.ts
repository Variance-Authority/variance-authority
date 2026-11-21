import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { commitRunsFile, encodeExecutionIndex, testCoverageFile, withCaseSections, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../bin.fixture.js';
import { main } from '../bin.js';
import { EXIT_CLEAN } from '../exit.js';
// Sense publishes the reader of these two and not their writers, which only
// a recording run calls, so this writes a record the way that run does.
import { landedChecks, type ChecksSection } from '../../../sense/src/test-selection/checks-record.js';
import { commitRunsText } from '../../../sense/src/test-selection/commit-runs-text.js';

/**
 * `variance ask not-run`, through the command a person types: a case whose
 * attempt passed without executing the check it declared is named with the
 * check, the case's file and line and the check's line; a file whose recording
 * did not finish names none and is named itself; a record older than checks is
 * told apart from a run that missed none.
 */

const cwd = process.cwd();
const COMMIT = 'f'.repeat(40);

beforeEach(() => {
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', mkdtempSync(join(tmpdir(), 'va-not-run-cache-')));
});

afterEach(() => {
  process.chdir(cwd);
  vi.unstubAllEnvs();
});

async function recorded(checks: ChecksSection | undefined): Promise<string> {
  // The cache is keyed by the path the checkout is at, which a temporary directory's name is not on macOS.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-not-run-')));
  execFileSync('git', ['init', '--quiet', '--initial-branch', 'main'], { cwd: root, stdio: 'pipe' });
  process.chdir(root);
  const at = testCoverageFile(root);
  await writeTestCoverage(at, { version: 3, instrumentation: 'fixture-instrumentation', commit: COMMIT, tests: [], modules: [] });
  writeFileSync(at, withCaseSections(readFileSync(at), {
    index: encodeExecutionIndex({ tests: [], modules: [] }),
    ...(checks === undefined ? {} : { checks: landedChecks(checks, COMMIT) }),
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

const SUBMITS = {
  file: 'tests/create-event.spec.ts',
  line: 42,
  name: 'create event > submits the form',
  project: 'chromium',
  declared: [{ id: 'create-event/submitted-title', line: 44 }],
};

describe('variance ask not-run', () => {
  it('names a declared check a passing attempt did not execute, with the case\'s file and line and the check\'s line', async () => {
    const at = await recorded({
      incomplete: [],
      cases: [{ ...SUBMITS, attempts: [{ attempt: 1, ended: 'failed', entered: ['create-event/submitted-title'] }, { attempt: 2, ended: 'passed', entered: [] }] }],
    });

    expect(await run(['ask', 'not-run'])).toEqual({
      code: EXIT_CLEAN,
      err: '',
      out: [
        `Read this checkout's record at ffffffffffff, landed under a minute ago, ${at}.`,
        '',
        'Declared checks not executed:',
        '  expected check create-event/submitted-title did not execute in case create event > submits the form ' +
          '(case tests/create-event.spec.ts:42, check line 44, project chromium, attempt 2), which passed',
        '1 declared check(s) entered.',
        '',
      ].join('\n'),
    });
  });

  it('tells a record whose run kept no checks from a run that missed none', async () => {
    const old = await recorded(undefined);
    expect((await run(['ask', 'not-run'])).out).toContain(
      `Declared checks not executed: checks were not kept in ${old}, so it does not say whether a declared check ran.`,
    );

    await recorded({
      incomplete: [],
      cases: [{ ...SUBMITS, attempts: [{ attempt: 1, ended: 'passed', entered: ['create-event/submitted-title'] }] }],
    });
    expect((await run(['ask', 'not-run'])).out).toContain('Declared checks not executed: none.\n1 declared check(s) entered.');
  });

  it('names no check of a file whose recording did not finish, and names the file', async () => {
    await recorded({
      incomplete: ['tests/create-event.spec.ts'],
      cases: [{ ...SUBMITS, attempts: [{ attempt: 1, ended: 'passed', entered: [] }] }],
    });

    expect((await run(['ask', 'not-run'])).out).toContain([
      'Declared checks not executed: none.',
      '0 declared check(s) entered.',
      'Incomplete, stopped before their runner ended them, so none of their checks is named: tests/create-event.spec.ts.',
    ].join('\n'));
  });

  it('names no check while a run that began after the checks landed has not landed its own', async () => {
    const at = await recorded({
      incomplete: [],
      cases: [{ ...SUBMITS, attempts: [{ attempt: 1, ended: 'passed', entered: [] }] }],
    });
    mkdirSync(join(dirname(at), '.run-1-killed-cases'));

    const { out } = await run(['ask', 'not-run']);
    expect(out).toContain(
      'Declared checks not executed: none named; a run began after these checks landed and did not land, ' +
        'stopped before its runner ended it or still running',
    );
    expect(out).not.toContain('did not execute in case');
  });

  it('says of each declared suite that recorded nothing that nothing was read, and why', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-not-run-')));
    execFileSync('git', ['init', '--quiet', '--initial-branch', 'main'], { cwd: root, stdio: 'pipe' });
    writeFileSync(join(root, 'variance.config.json'), JSON.stringify({ suites: { unit: { kind: 'unit' }, chromium: { kind: 'e2e' } } }));
    process.chdir(root);

    expect(await run(['ask', 'not-run'])).toEqual({
      code: EXIT_CLEAN,
      err: '',
      out: expect.stringMatching(new RegExp([
        'Declared checks not executed, suite chromium: none read from \\S+/suites/chromium/coverage\\.bin, nothing is recorded there\\.',
        '',
        'Declared checks not executed, suite unit: none read from \\S+/suites/unit/coverage\\.bin, nothing is recorded there\\.',
        '',
      ].join('\n'))),
    });
  });

  it('says a checks section it cannot read is unread, rather than that no check was missed', async () => {
    const at = await recorded(undefined);
    writeFileSync(at, withCaseSections(readFileSync(at), { checks: Buffer.from('not a checks section') }));

    expect(await run(['ask', 'not-run'])).toEqual({
      code: EXIT_CLEAN,
      err: '',
      out: `Declared checks not executed: none read from ${at}, the record's checks section is not JSON.\n`,
    });
  });
});
