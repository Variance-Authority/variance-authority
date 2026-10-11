import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from '@playwright/test';
import { decodeExecutionIndex } from '@variance-authority/sense/test-selection';
import { afterAll, describe, expect, it } from 'vitest';

// One spec run by two Playwright projects, `desktop` and `narrow`, recorded
// through `withTestSelection` into a directory of its own for each run.
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../..');
const fixture = resolve(here, '../test/fixtures/twin-projects');
const spec = 'packages/playwright-test/test/fixtures/twin-projects/tests/greet.spec.ts';
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
    '\npackages/playwright-test projects: skipped.' +
      '\n  no browser — npx playwright install chromium\n',
  );
}

afterAll(async () => {
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
});

/** The case ids one Playwright run with `args` recorded. */
async function idsAfter(args: readonly string[]): Promise<readonly string[]> {
  const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-playwright-projects-'));
  directories.push(directory);
  const coverageFile = resolve(directory, 'coverage.bin');
  await promisify(execFile)(
    process.execPath,
    [resolve(repository, 'node_modules/@playwright/test/cli.js'), 'test', '--config', resolve(fixture, 'playwright.config.mjs'), ...args],
    {
      cwd: fixture,
      env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: coverageFile, VARIANCE_AUTHORITY_CACHE: resolve(directory, 'cache') },
    },
  );
  return decodeExecutionIndex(await readFile(coverageFile)).tests.map((recorded) => recorded.id).sort();
}

describe.runIf(BROWSER_AVAILABLE)('a spec two Playwright projects run', () => {
  it('tells the copies of a case apart by the project that ran each', async () => {
    expect(await idsAfter([])).toEqual([`|desktop| ${spec} > greets by name`, `|narrow| ${spec} > greets by name`]);
  }, 120_000);

  it('names a case the same whether the run took every project or one', async () => {
    expect(await idsAfter(['--project', 'narrow'])).toEqual([`|narrow| ${spec} > greets by name`]);
  }, 120_000);
});
