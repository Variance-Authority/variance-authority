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

// Three spec files of three tests each under `fullyParallel`, recorded through
// `withTestSelection` into a directory of its own for each run. Nothing is
// recorded before the run, so every file is priced the same and placed in
// code-unit order: `one` and `two` on shard 1, `three` on shard 2. Playwright's
// own split, by test, would give shard 1 five tests and so cut a file in two.
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../..');
const fixture = resolve(here, '../test/fixtures/sharded-files');
const directories: string[] = [];

const BROWSER_AVAILABLE = ((): boolean => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

if (!BROWSER_AVAILABLE) {
  console.warn('\npackages/playwright-test sharded files: skipped.\n  no browser — npx playwright install chromium\n');
}

afterAll(async () => {
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
});

/** Each recorded case's file, and what the run said on stderr. */
async function run(args: readonly string[]): Promise<{ readonly files: readonly string[]; readonly stderr: string }> {
  const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-playwright-shard-'));
  directories.push(directory);
  const coverageFile = resolve(directory, 'coverage.bin');
  const { stderr } = await promisify(execFile)(
    process.execPath,
    [resolve(repository, 'node_modules/@playwright/test/cli.js'), 'test', '--config', resolve(fixture, 'playwright.config.mjs'), ...args],
    {
      cwd: fixture,
      env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: coverageFile, VARIANCE_AUTHORITY_CACHE: resolve(directory, 'cache') },
    },
  );
  const index = decodeExecutionIndex(await readFile(coverageFile));
  return { files: index.tests.map((recorded) => recorded.id.split(' > ')[0]!).sort(), stderr };
}

const fileSet = (files: readonly string[]) => [...new Set(files)].sort();

describe.runIf(BROWSER_AVAILABLE)('a fullyParallel suite run as two shards', () => {
  it('runs each file whole in exactly one shard, and the shards together run the suite', async () => {
    const [whole, first, second] = await Promise.all([run([]), run(['--shard', '1/2']), run(['--shard', '2/2'])]);

    expect(fileSet(whole.files)).toHaveLength(3);
    expect(fileSet(first.files)).toHaveLength(2);
    expect(fileSet(first.files).filter((file) => fileSet(second.files).includes(file))).toEqual([]);
    expect(fileSet([...first.files, ...second.files])).toEqual(fileSet(whole.files));
    expect([...first.files, ...second.files].sort()).toEqual(whole.files);
    expect(first.stderr).toMatch(/variance-authority: shard 1\/2 by file count: 2 of 3 files; /);
    expect(second.stderr).toMatch(/variance-authority: shard 2\/2 by file count: 1 of 3 files; /);
  }, 180_000);
});
