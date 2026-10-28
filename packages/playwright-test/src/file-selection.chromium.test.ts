import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from '@playwright/test';
import { afterAll, describe, expect, it } from 'vitest';

// Three spec files of three tests each, run through `withTestSelection` with a
// selection handed in by `FIXTURE_SKIP`, as `VARIANCE_AUTHORITY_SINCE` would
// read one from the record.
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../..');
const fixture = resolve(here, '../test/fixtures/sharded-files');
const named = (file: string) => `packages/playwright-test/test/fixtures/sharded-files/tests/${file}`;
const directories: string[] = [];

const BROWSER_AVAILABLE = ((): boolean => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

if (!BROWSER_AVAILABLE) {
  console.warn('\npackages/playwright-test file selection: skipped.\n  no browser — npx playwright install chromium\n');
}

afterAll(async () => {
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
});

/** Each file the line reporter says ran, what the run said on stderr and in all, and how it exited. */
async function run(
  args: readonly string[],
  env: Readonly<Record<string, string>>,
): Promise<{ readonly ran: readonly string[]; readonly stderr: string; readonly output: string; readonly code: number }> {
  const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-playwright-selection-'));
  directories.push(directory);
  const done = await promisify(execFile)(
    process.execPath,
    [resolve(repository, 'node_modules/@playwright/test/cli.js'), 'test', '--config', resolve(fixture, 'playwright.config.mjs'), ...args],
    {
      cwd: fixture,
      env: {
        ...process.env,
        VARIANCE_AUTHORITY_COVERAGE: resolve(directory, 'coverage.bin'),
        VARIANCE_AUTHORITY_CACHE: resolve(directory, 'cache'),
        ...env,
      },
    },
  ).then(
    (output) => ({ ...output, code: 0 }),
    (error: { stdout: string; stderr: string; code: number }) => ({ stdout: error.stdout, stderr: error.stderr, code: error.code }),
  );
  const ran = [...new Set([...done.stdout.matchAll(/^\[\d+\/\d+\] tests\/(\S+\.spec\.ts):/gmu)].map((line) => line[1]!))].sort();
  return { ran, stderr: done.stderr, output: `${done.stdout}${done.stderr}`, code: done.code };
}

describe.runIf(BROWSER_AVAILABLE)('a Playwright run handed a selection', () => {
  it('runs only the files the selection keeps, and says how many of the files it found', async () => {
    const selected = await run([], { FIXTURE_SKIP: JSON.stringify([named('two.spec.ts')]) });

    expect(selected.ran).toEqual(['one.spec.ts', 'three.spec.ts']);
    expect(selected.stderr).toContain('variance-authority: selected 2 of 3');
    expect(selected.code).toBe(0);
  }, 180_000);

  it('drops the skipped files before a shard is placed, so the shards split what was kept', async () => {
    const skip = { FIXTURE_SKIP: JSON.stringify([named('one.spec.ts')]) };
    const [first, second] = await Promise.all([run(['--shard', '1/2'], skip), run(['--shard', '2/2'], skip)]);

    expect([...first.ran, ...second.ran].sort()).toEqual(['three.spec.ts', 'two.spec.ts']);
    expect(first.ran).toHaveLength(1);
    expect(first.stderr).toMatch(/variance-authority: shard 1\/2 by file count: 1 of 2 files; /);
  }, 180_000);

  it('passes a selection that skips every file, and says it selected none', async () => {
    const none = await run([], { FIXTURE_SKIP: JSON.stringify(['one', 'two', 'three'].map((file) => named(`${file}.spec.ts`))) });

    expect(none.ran).toEqual([]);
    expect(none.stderr).toContain('variance-authority: selected none of 3');
    expect(none.code).toBe(0);
  }, 180_000);

  it('fails a run whose own filter finds no test among the files the selection kept', async () => {
    const filtered = await run(['--grep', 'no test has this title'], { FIXTURE_SKIP: JSON.stringify([named('two.spec.ts')]) });

    expect(filtered.ran).toEqual([]);
    expect(filtered.output).toContain('No tests found');
    expect(filtered.code).toBe(1);
  }, 180_000);

  // Playwright filters by the files a command line names after `testIgnore`,
  // so the selection kept the files the argument then left out, and the run
  // fails on "No tests found".
  it.todo('passes a selection that skips the only file named on the command line — needs the command-line file filter applied to the files the selection kept');

  it('fails the run, exiting 1, when the selection refuses the record it read', async () => {
    const refused = await run([], { FIXTURE_REFUSE: 'the record at coverage.bin could not be read' });

    expect(refused.ran).toEqual([]);
    expect(refused.output).toContain('the record at coverage.bin could not be read');
    expect(refused.code).toBe(1);
  }, 180_000);
});
