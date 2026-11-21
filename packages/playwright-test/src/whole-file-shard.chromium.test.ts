import { readFile } from 'node:fs/promises';
import { decodeExecutionIndex, keepsCases } from '@variance-authority/sense/test-selection';
import { afterAll, describe, expect, it } from 'vitest';
import { BROWSER_AVAILABLE, removeRuns } from './runs.fixture.js';
import { passing } from './sharded-files.fixture.js';

// Three spec files of three tests each under `fullyParallel`. With nothing
// recorded before the run, every file is priced the same and placed in
// code-unit order: `one` and `two` on shard 1, `three` on shard 2. Playwright's
// own split, by test, would give shard 1 five tests and so cut a file in two.
// How a shard is placed once a run has recorded times is
// `whole-file-shard-times.chromium.test.ts`.

if (!BROWSER_AVAILABLE) {
  console.warn('\npackages/playwright-test sharded files: skipped.\n  no browser — npx playwright install chromium\n');
}

afterAll(removeRuns);

const fileSet = (files: readonly string[]) => [...new Set(files)].sort();

/** Each recorded case's file, run by a shard that passed; a record that keeps no case index ran none. */
async function shardFiles(args: readonly string[]): Promise<{ readonly files: readonly string[]; readonly ran: readonly string[]; readonly stderr: string }> {
  const { coverageFile, ran, stderr } = await passing(args);
  if (!keepsCases(coverageFile)) return { files: [], ran, stderr };
  const index = decodeExecutionIndex(await readFile(coverageFile));
  return { files: index.tests.map((test) => test.id.split(' > ')[0]!).sort(), ran, stderr };
}

describe.runIf(BROWSER_AVAILABLE)('a fullyParallel suite run as two shards', () => {
  it('runs each file whole in exactly one shard, and the shards together run the suite', async () => {
    const [whole, first, second] = await Promise.all([shardFiles([]), shardFiles(['--shard', '1/2']), shardFiles(['--shard', '2/2'])]);

    expect(fileSet(whole.files)).toHaveLength(3);
    expect(fileSet(first.files)).toHaveLength(2);
    expect(fileSet(first.files).filter((file) => fileSet(second.files).includes(file))).toEqual([]);
    expect(fileSet([...first.files, ...second.files])).toEqual(fileSet(whole.files));
    expect([...first.files, ...second.files].sort()).toEqual(whole.files);
    expect(first.stderr).toMatch(/variance-authority: shard 1\/2 by file count: 2 of 3 files; /);
    expect(second.stderr).toMatch(/variance-authority: shard 2\/2 by file count: 1 of 3 files; /);
  }, 180_000);

  it('passes a shard left no file, because there are fewer files than shards', async () => {
    const empty = await shardFiles(['--shard', '4/4']);

    expect(empty.files).toEqual([]);
    expect(empty.ran).toEqual([]);
    expect(empty.stderr).toMatch(/variance-authority: shard 4\/4 by file count: 0 of 3 files; /);
  }, 180_000);
});
