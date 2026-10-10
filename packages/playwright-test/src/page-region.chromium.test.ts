import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from '@playwright/test';
import { afterAll, describe, expect, it } from 'vitest';

// Specs run through the fixtures as a suite runs them: one sets `timezoneId` and
// `locale` with `test.use`, one sets neither under a project that sets neither,
// and one runs under a project that sets both.
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../..');
const fixture = resolve(here, '../test/fixtures/page-region');
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
    '\npackages/playwright-test page region: skipped.\n  no browser — npx playwright install chromium\n',
  );
}

afterAll(async () => {
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
});

// A host timezone that is not UTC on every machine, a CI runner in UTC
// included, so a page left in the host's timezone reads differently from one
// pinned to UTC.
const HOST = { TZ: 'Pacific/Kiritimati' };

async function runSpec(spec: string, env: NodeJS.ProcessEnv = {}): Promise<{ stdout: string }> {
  const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-playwright-region-'));
  directories.push(directory);
  return await promisify(execFile)(
    process.execPath,
    [resolve(repository, 'node_modules/@playwright/test/cli.js'), 'test', '--config', resolve(fixture, 'playwright.config.mjs'), spec],
    { cwd: fixture, env: { ...process.env, ...env, VARIANCE_AUTHORITY_BASELINES: resolve(directory, 'baselines') } },
  );
}

describe.runIf(BROWSER_AVAILABLE)('the region a test is handed', () => {
  it('paints in the timezone and locale its page runs in, not the project default', async () => {
    await expect(runSpec('tests/region.spec.ts')).resolves.toMatchObject({ stdout: expect.stringContaining('1 passed') });
  }, 120_000);

  it('opens the page in UTC and en-US, not the host timezone, when nothing declares either', async () => {
    await expect(runSpec('tests/undeclared.spec.ts', HOST)).resolves.toMatchObject({
      stdout: expect.stringContaining('1 passed'),
    });
  }, 120_000);

  it('opens the page in the timezone and locale the project declares', async () => {
    await expect(runSpec('tests/declared.spec.ts', HOST)).resolves.toMatchObject({
      stdout: expect.stringContaining('1 passed'),
    });
  }, 120_000);
});
