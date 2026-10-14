import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readTestCoverage, writeTestCoverage, type TestCoverage } from '@variance-authority/sense/test-selection';
import { landJourneys } from './land.js';

/**
 * N shard records landed as the one this repository reads. The shards are
 * real records on disk, combined by the native addon, and the landing is read
 * back from the file it wrote.
 */

let home: string;
let into: string;

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), 'variance-land-shards-')));
  into = join(home, 'coverage.bin');
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

/** One shard: a single whole observation, and `CartCard` entered by it alone. */
function shardOf(observer: string, commit: string | undefined = 'c0ffee'): TestCoverage {
  return {
    version: 3,
    instrumentation: 'fixture',
    ...(commit === undefined ? {} : { commit }),
    tests: [{ file: observer, complete: true, preconditions: [] }],
    modules: [
      {
        file: 'app/src/components/CartCard.tsx',
        sourceDigest: 'source:cart',
        instrumented: true,
        blocks: [
          {
            ordinal: 0,
            kind: 'module',
            digest: 'block:0',
            name: 'CartCard',
            path: 'module',
            startLine: 1,
            endLine: 80,
            source: true,
            testFiles: [observer],
          },
        ],
      },
    ],
  };
}

/** Write `shards` as records, `shard-<n>.bin` each, and return their paths. */
async function written(...shards: TestCoverage[]): Promise<string[]> {
  return Promise.all(
    shards.map(async (shard, index) => {
      const path = join(home, `shard-${index + 1}.bin`);
      await writeTestCoverage(path, shard);
      return path;
    }),
  );
}

/** The files in `home` other than the shards: what the landing left behind. */
async function left(): Promise<string[]> {
  return (await readdir(home)).filter((name) => !name.startsWith('shard-')).sort();
}

describe('landJourneys — N shard records into the one this repository reads', () => {
  it('combines the shards and lands the union, saying where it stands', async () => {
    const shards = await written(shardOf('story:a'), shardOf('story:b'));

    const landed = await landJourneys(home, shards, into);

    // No shard kept cases in its record, and there are none here to drop.
    expect(landed).toEqual({
      at: into, shards: 2, commit: 'c0ffee', observations: 2, modules: 1,
      cases: { unanswered: into, shard: shards.join(', '), removed: false },
    });
    const record = await readTestCoverage(into);
    expect(record.tests.map((test) => test.file)).toEqual(['story:a', 'story:b']);
    expect(record.modules[0]?.blocks[0]?.testFiles).toEqual(['story:a', 'story:b']);
    expect(await left()).toEqual(['coverage.bin', 'coverage.runs.json']);
  });

  it('lands where --into says instead, and the reading is pointed there', async () => {
    const shards = await written(shardOf('story:a'));
    const elsewhere = join(home, 'elsewhere');
    await mkdir(elsewhere);
    const folded = join(elsewhere, 'folded.bin');

    const landed = await landJourneys(home, shards, folded);

    expect(landed.at).toBe(folded);
    expect((await readTestCoverage(folded)).tests.map((test) => test.file)).toEqual(['story:a']);
    // Staged beside the target and renamed over it: nothing is left beside either.
    expect((await readdir(elsewhere)).sort()).toEqual(['folded.bin', 'folded.runs.json']);
    expect(await left()).toEqual(['elsewhere']);
  });

  it('layers the combine over what was already there, so a baseline lands under local evidence', async () => {
    // The runner's own rule. The result stands where the combine stands,
    // retires what it re-recorded whole, and keeps the local observation it
    // did not — a fetched baseline is a floor, not a replacement.
    await writeTestCoverage(into, shardOf('story:local', 'l0ca1'));
    const shards = await written(shardOf('story:a'), shardOf('story:b'));

    const landed = await landJourneys(home, shards, into);

    expect(landed).toMatchObject({ commit: 'c0ffee', observations: 3 });
    const record = await readTestCoverage(into);
    expect(record.tests.map((test) => test.file)).toEqual(['story:a', 'story:b', 'story:local']);
  });

  it('refuses a shard that is not there, by name, and writes nothing', async () => {
    const [shard] = await written(shardOf('story:a'));
    const missing = join(home, 'shard-9.bin');

    await expect(landJourneys(home, [shard!, missing], into)).rejects.toThrow(`there is no record at ${missing}`);
    expect(await left()).toEqual([]);
  });

  it('refuses shards that were not one run, in the combine\'s own words', async () => {
    const shards = await written(shardOf('story:a', 'c0ffee'), shardOf('story:b', 'decaf0'));

    await expect(landJourneys(home, shards, into)).rejects.toThrow(
      /shard-[12]\.bin and .*shard-[12]\.bin disagree about the commit/,
    );
    expect(await left()).toEqual([]);
  });

  it('refuses to write over a snapshot it cannot read, rather than replacing it', async () => {
    await writeFile(into, 'not a record');
    const shards = await written(shardOf('story:a'));

    await expect(landJourneys(home, shards, into)).rejects.toThrow(`the snapshot already at ${into} could not be read`);
    expect(await left()).toEqual(['coverage.bin']);
  });
});
