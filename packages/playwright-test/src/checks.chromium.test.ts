import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from '@playwright/test';
import { afterAll, describe, expect, it } from 'vitest';
// The reading is the one `variance ask not-run` prints, over the record this
// run wrote rather than the checkout's, so it is read the way that question reads it.
import { checksAt } from '../../sense/src/recorded-checks.js';
import { formatNotRun } from '../../help/src/tools/not-run.js';

// Real Playwright runs over a create-event form whose submit drops the title on
// one branch, a case that checks the title only when one was sent, and a retried
// case whose failed first attempt enters its check and whose passing retry does not.
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../..');
const fixture = resolve(here, '../test/fixtures/create-event');
const spec = 'packages/playwright-test/test/fixtures/create-event/tests/create-event.spec.ts';
const directories: string[] = [];

const BROWSER_AVAILABLE = ((): boolean => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

if (!BROWSER_AVAILABLE) {
  console.warn(
    '\npackages/playwright-test checks: skipped.' +
      '\n  no browser — npx playwright install chromium\n',
  );
}

afterAll(async () => {
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
});

/** A record no run has written yet. */
async function freshRecord(): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-playwright-checks-'));
  directories.push(directory);
  return resolve(directory, 'coverage.bin');
}

/** Run the fixture under `env` and `args`, recording into `coverageFile`. */
async function run(coverageFile: string, env: Readonly<Record<string, string>>, args: readonly string[] = []): Promise<void> {
  await promisify(execFile)(
    process.execPath,
    [resolve(repository, 'node_modules/@playwright/test/cli.js'), 'test', '--config', resolve(fixture, 'playwright.config.mjs'), ...args],
    { cwd: fixture, env: { ...process.env, ...env, VARIANCE_AUTHORITY_COVERAGE: coverageFile, VARIANCE_AUTHORITY_CACHE: resolve(dirname(coverageFile), 'cache') } },
  ).catch(() => undefined);
}

/** The reading `not-run` prints of the record at `coverageFile`. */
const readingOf = (coverageFile: string): string =>
  formatNotRun([{ recording: coverageFile, origin: 'own', ...checksAt(coverageFile) }], Date.now());

/** The reading `not-run` prints of one run of the fixture under `env`. */
async function reading(env: Readonly<Record<string, string>>): Promise<string> {
  const coverageFile = await freshRecord();
  await run(coverageFile, env);
  return readingOf(coverageFile);
}

/** The fixture's line whose trailing comment names the call. */
const line = (call: string): number =>
  readFileSync(resolve(repository, spec), 'utf8').split('\n').findIndex((text) => text.endsWith(`// ${call}`)) + 1;

describe.runIf(BROWSER_AVAILABLE)('a Playwright case that passes without entering a check its body calls', () => {
  it('names the check, the case, the line of each and that it passed', async () => {
    const read = await reading({ DROP_TITLE: '1' });
    expect(read).toContain(
      'expected check create-event/submitted-title did not execute in case create-event > submits the form ' +
        `(case ${spec}:${line('bypassing case')}, check line ${line('bypassed check')}), which passed`,
    );
  }, 120_000);

  it('names a check the passing retry left out, though the failed attempt before it entered it', async () => {
    const read = await reading({});
    expect(read).toContain(
      'expected check create-event/retried-title did not execute in case retries > passes the retry without its check ' +
        `(case ${spec}:${line('retried case')}, check line ${line('retried check')}, attempt 2), which passed`,
    );
  }, 120_000);

  it('names no check a passing case entered', async () => {
    const read = await reading({});
    expect(read).not.toContain('create-event/submitted-title did not execute');
    expect(read).toContain('2 declared check(s) entered');
  }, 120_000);

  it('reads a run the runner stopped before it ended a case as incomplete, and names no missing check there', async () => {
    const read = await reading({ DROP_TITLE: '1', STALL: '1' });
    expect(read).toContain(`Incomplete, stopped before their runner ended them, so none of their checks is named: ${spec}.`);
    expect(read).not.toContain('did not execute');
  }, 120_000);

  it('reads a run killed before any reporter could end it as unfinished, not as the run before it', async () => {
    const coverageFile = await freshRecord();
    await run(coverageFile, {});
    await run(coverageFile, { DROP_TITLE: '1', STALL: 'SIGKILL' });
    const read = readingOf(coverageFile);
    expect(read).toContain('did not land');
    expect(read).not.toContain('declared check(s) entered');
  }, 180_000);

  it('reads a killed run that collected no declaring case as unfinished, not as the run before it', async () => {
    const coverageFile = await freshRecord();
    await run(coverageFile, { DROP_TITLE: '1' });
    await run(coverageFile, { DROP_TITLE: '1', STALL: 'SIGKILL' }, ['--grep', 'lists events']);
    const read = readingOf(coverageFile);
    expect(read).toContain('did not land');
    expect(read).not.toContain('did not execute');
  }, 180_000);

  it('reads a later run that collected no case, not the run before it', async () => {
    const coverageFile = await freshRecord();
    await run(coverageFile, { DROP_TITLE: '1' });
    expect(readingOf(coverageFile)).toContain('did not execute');
    await run(coverageFile, { DROP_TITLE: '1' }, ['--grep', 'no case is titled this', '--pass-with-no-tests']);
    expect(readingOf(coverageFile)).not.toContain('did not execute');
  }, 180_000);
});
