import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from '@playwright/test';
import { afterAll, describe, expect, it } from 'vitest';

// One spec, two projects, and `varianceBaselinePath` placing by `{project}`,
// run through the fixtures as a suite runs them.
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../..');
const fixture = resolve(here, '../test/fixtures/placed-baselines');
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
    '\npackages/playwright-test placed baselines: skipped.' +
      '\n  no browser — npx playwright install chromium\n',
  );
}

afterAll(async () => {
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
});

describe.runIf(BROWSER_AVAILABLE)('the baseline path a Playwright suite sets', () => {
  it('writes each project`s baseline where the template names it', async () => {
    const baselines = await mkdtemp(resolve(tmpdir(), 'variance-authority-playwright-placed-'));
    directories.push(baselines);

    await promisify(execFile)(
      process.execPath,
      [resolve(repository, 'node_modules/@playwright/test/cli.js'), 'test', '--config', resolve(fixture, 'playwright.config.mjs'), '--update-snapshots'],
      { cwd: fixture, env: { ...process.env, VARIANCE_AUTHORITY_BASELINES: baselines } },
    );

    const written = (await readdir(baselines, { recursive: true })).filter((name) => name.endsWith('.webp')).sort();
    expect(written).toEqual(['dark/Greeting/says-hello-chromium.webp', 'light/Greeting/says-hello-chromium.webp']);
  }, 120_000);
});
