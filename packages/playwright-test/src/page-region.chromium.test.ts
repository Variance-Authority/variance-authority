import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from '@playwright/test';
import { afterAll, describe, expect, it } from 'vitest';

// A spec that sets `timezoneId` and `locale` with `test.use`, under a project that
// sets neither, run through the fixtures as a suite runs them.
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

describe.runIf(BROWSER_AVAILABLE)('the renderer a test is handed', () => {
  it('paints in the timezone and locale its page runs in, not the project default', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-playwright-region-'));
    directories.push(directory);

    const run = promisify(execFile)(
      process.execPath,
      [resolve(repository, 'node_modules/@playwright/test/cli.js'), 'test', '--config', resolve(fixture, 'playwright.config.mjs')],
      { cwd: fixture, env: { ...process.env, VARIANCE_AUTHORITY_BASELINES: resolve(directory, 'baselines') } },
    );

    await expect(run).resolves.toMatchObject({ stdout: expect.stringContaining('1 passed') });
  }, 120_000);
});
