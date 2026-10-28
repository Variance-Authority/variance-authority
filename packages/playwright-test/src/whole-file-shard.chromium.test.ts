import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from '@playwright/test';
import { decodeExecutionIndex } from '@variance-authority/sense/test-selection';
import { afterAll, describe, expect, it } from 'vitest';

// Three spec files of three tests each under `fullyParallel`, recorded through
// `withTestSelection` into a directory of its own for each run. With nothing
// recorded before the run, every file is priced the same and placed in
// code-unit order: `one` and `two` on shard 1, `three` on shard 2. Playwright's
// own split, by test, would give shard 1 five tests and so cut a file in two.
// `three` is the slow file: once a run has recorded it, it outweighs the others.
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

const fileSet = (files: readonly string[]) => [...new Set(files)].sort();

/**
 * Each recorded case's file, each file the line reporter says ran, what the run
 * said on stderr, and where it recorded. `recorded` is a record the run starts
 * from, copied in so shards never share one; the record then holds what it
 * started from too, so `ran` is what this run ran.
 */
async function run(
  args: readonly string[],
  recorded?: string,
): Promise<{ readonly files: readonly string[]; readonly ran: readonly string[]; readonly stderr: string; readonly coverageFile: string }> {
  const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-playwright-shard-'));
  directories.push(directory);
  const coverageFile = resolve(directory, 'coverage.bin');
  if (recorded !== undefined) await copyFile(recorded, coverageFile);
  const { stdout, stderr } = await promisify(execFile)(
    process.execPath,
    [resolve(repository, 'node_modules/@playwright/test/cli.js'), 'test', '--config', resolve(fixture, 'playwright.config.mjs'), ...args],
    {
      cwd: fixture,
      env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: coverageFile, VARIANCE_AUTHORITY_CACHE: resolve(directory, 'cache') },
    },
  );
  const ran = fileSet([...stdout.matchAll(/^\[\d+\/\d+\] tests\/(\S+\.spec\.ts):/gmu)].map((line) => line[1]!));
  if (!existsSync(coverageFile)) return { files: [], ran, stderr, coverageFile };
  const index = decodeExecutionIndex(await readFile(coverageFile));
  return { files: index.tests.map((test) => test.id.split(' > ')[0]!).sort(), ran, stderr, coverageFile };
}


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

  it('places by the times a run recorded, not by count, once there are times', async () => {
    const whole = await run([]);
    const [first, second] = await Promise.all([run(['--shard', '1/2'], whole.coverageFile), run(['--shard', '2/2'], whole.coverageFile)]);

    // By count shard 1 would take `one` and `two`; by time the slow `three` has a shard to itself.
    expect(first.ran).toEqual(['three.spec.ts']);
    expect(second.ran).toEqual(['one.spec.ts', 'two.spec.ts']);
    expect(first.stderr).toMatch(/variance-authority: shard 1\/2 by the times recorded at .*: 1 of 3 files, /);
  }, 180_000);

  it('passes a shard left no file, because there are fewer files than shards', async () => {
    const empty = await run(['--shard', '4/4']);

    expect(empty.files).toEqual([]);
    expect(empty.ran).toEqual([]);
    expect(empty.stderr).toMatch(/variance-authority: shard 4\/4 by file count: 0 of 3 files; /);
  }, 180_000);
});
