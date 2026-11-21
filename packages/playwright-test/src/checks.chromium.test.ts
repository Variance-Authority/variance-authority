import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
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
// one branch, and a case that checks the title only when one was sent.
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

/** One run of the fixture into `coverageFile`, under `env` and Playwright's own `args`. */
async function run(coverageFile: string, env: Readonly<Record<string, string>>, args: readonly string[] = []): Promise<void> {
  await promisify(execFile)(
    process.execPath,
    [resolve(repository, 'node_modules/@playwright/test/cli.js'), 'test', '--config', resolve(fixture, 'playwright.config.mjs'), ...args],
    { cwd: fixture, env: { ...process.env, ...env, VARIANCE_AUTHORITY_COVERAGE: coverageFile, VARIANCE_AUTHORITY_CACHE: resolve(dirname(coverageFile), 'cache') } },
  ).catch(() => undefined);
}

const readingOf = (coverageFile: string): string =>
  formatNotRun([{ recording: coverageFile, origin: 'own', ...checksAt(coverageFile) }], Date.now());

/** The reading of one run of the fixture, under `env` and Playwright's own `args`. */
async function reading(env: Readonly<Record<string, string>>, args: readonly string[] = []): Promise<string> {
  const coverageFile = await freshRecord();
  await run(coverageFile, env, args);
  return readingOf(coverageFile);
}

describe.runIf(BROWSER_AVAILABLE)('a Playwright case whose declared check did not execute', () => {
  it('names the check, the case, where it is declared and that it passed', async () => {
    const read = await reading({ DROP_TITLE: '1' });
    expect(read).toContain('expected check create-event/submitted-title did not execute in case create-event > submits the form');
    expect(read).toContain(`${spec}:42`);
    expect(read).toMatch(/submits the form.*passed/);
  }, 120_000);

  it('names nothing missing where the case entered its check', async () => {
    const read = await reading({});
    expect(read).not.toContain('did not execute');
    expect(read).toContain('1 declared check(s) entered');
  }, 120_000);

  it('names the grep as the scope, and no check of a case it left out', async () => {
    const read = await reading({ DROP_TITLE: '1' }, ['--grep', 'lists events']);
    expect(read).toContain('--grep "lists events"');
    expect(read).not.toContain('did not execute');
  }, 120_000);

  it('names only the project the run collected, not every one configured', async () => {
    const read = await reading({ PROJECTS: 'first,second' }, ['--project', 'first']);
    expect(read).toContain('Scope: project first;');
    expect(read).not.toContain('project second');
  }, 120_000);

  it('reads a later run that landed no case, not the run before it', async () => {
    const coverageFile = await freshRecord();
    await run(coverageFile, { DROP_TITLE: '1' });
    await run(coverageFile, { DROP_TITLE: '1' }, ['--grep', 'no case is titled this', '--pass-with-no-tests']);
    const read = readingOf(coverageFile);
    expect(read).toContain('--grep "no case is titled this"');
    expect(read).not.toContain('did not execute');
  }, 180_000);

  it('names a check whose step was skipped by its title', async () => {
    const read = await reading({ DROP_TITLE: '1', SKIP_STEP: '1' });
    expect(read).toContain('expected check create-event/submitted-title did not execute in case create-event > submits the form');
  }, 120_000);

  it('reads a run killed before any reporter could end it as incomplete, not as the run before it', async () => {
    const coverageFile = await freshRecord();
    await run(coverageFile, {});
    await run(coverageFile, { DROP_TITLE: '1', STALL: 'SIGKILL' });
    const read = readingOf(coverageFile);
    expect(read).toContain('incomplete');
    expect(read).not.toContain('1 declared check(s) entered');
  }, 180_000);

  it('reads a run the runner stopped before it ended as incomplete, and names no missing check', async () => {
    const read = await reading({ DROP_TITLE: '1', STALL: '1' });
    expect(read).toContain('incomplete');
    expect(read).not.toContain('did not execute');
  }, 120_000);
});
