import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { caseSectionsAt, readTestCoverage, recordDigestAt, writeTestCoverage, type TestCoverage } from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';
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
      cases: { unanswered: into, shards, removed: false },
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

  it('names the record every shard read, and the one it was laid over, as a run does', async () => {
    const read = `sha256:${'0123456789ab'.repeat(5)}0123`;
    const shards = [join(home, 'shard-1.bin'), join(home, 'shard-2.bin')];
    await writeTestCoverage(shards[0]!, shardOf('story:a'), { base: Buffer.from(`${read} over none`) });
    await writeTestCoverage(shards[1]!, shardOf('story:b'), { base: Buffer.from(`${read} over none`) });
    await writeTestCoverage(into, shardOf('story:local', 'l0ca1'));
    const laid = recordDigestAt(into);

    await landJourneys(home, shards, into);

    expect(Buffer.from(caseSectionsAt(into).base ?? []).toString()).toBe(`${read} over ${laid}`);
  });

  it('lands a shard that cannot name the record its selection read, and says its read was not checked', async () => {
    const shards = [join(home, 'shard-1.bin'), join(home, 'shard-2.bin')];
    await writeTestCoverage(shards[0]!, shardOf('story:a'), { base: Buffer.from('unknown over none') });
    await writeTestCoverage(shards[1]!, shardOf('story:b'), { base: Buffer.from('none') });

    const landed = await landJourneys(home, shards, into);

    expect(landed.unchecked).toEqual([shards[0]]);
    expect(Buffer.from(caseSectionsAt(into).base ?? []).toString()).toBe('unknown over none');
  });

  it('refuses a shard that is not there, by name, and writes nothing', async () => {
    const [shard] = await written(shardOf('story:a'));
    const missing = join(home, 'shard-9.bin');

    await expect(landJourneys(home, [shard!, missing], into)).rejects.toThrow(`there is no record at ${missing}`);
    expect(await left()).toEqual([]);
  });

  it('fails when the shards started from different records, in the combine\'s own words', async () => {
    const shards = await written(shardOf('story:a', 'c0ffee'), shardOf('story:b', 'decaf0'));

    await expect(landJourneys(home, shards, into)).rejects.toThrow(
      `the build failed because the sharding was unstable: ${shards[0]} started from commit \`c0ffee\`, ` +
        `and ${shards[1]} from commit \`decaf0\`.`,
    );
    expect(await left()).toEqual([]);
  });

  it('fails when the shards started from different cached records, though the landing discards their layers', async () => {
    const [one, two] = ['0123456789ab'.repeat(5) + '0123', 'fedcba987654'.repeat(5) + 'fedc'].map((hex) => `sha256:${hex}`);
    const shards = [join(home, 'shard-1.bin'), join(home, 'shard-2.bin')];
    for (const [first, second] of [[one!, two!], [two!, one!]] as const) {
      // Both chose their tests from no record, and were laid over two.
      await writeTestCoverage(shards[0]!, shardOf('story:a'), { base: Buffer.from(`none over ${first}`) });
      await writeTestCoverage(shards[1]!, shardOf('story:b'), { base: Buffer.from(`none over ${second}`) });

      await expect(landJourneys(home, [...shards].reverse(), into)).rejects.toThrow(
        `the build failed because the sharding was unstable: ${shards[0]} started from the record ${first.slice(0, 19)}, ` +
          `and ${shards[1]} from the record ${second.slice(0, 19)}. `,
      );
      await expect(landJourneys(home, shards, into)).rejects.toThrow('Nothing of this build is combined, so the record before it stands. Shards start alike when every one restores the same cached record');
      expect(await left()).toEqual([]);
    }
  });

  it('refuses to write over a snapshot it cannot read, rather than replacing it', async () => {
    await writeFile(into, 'not a record');
    const shards = await written(shardOf('story:a'));

    await expect(landJourneys(home, shards, into)).rejects.toThrow(`the snapshot already at ${into} could not be read`);
    expect(await left()).toEqual(['coverage.bin']);
  });

  it('refuses to lay over a snapshot under other probes, naming them, and leaves it as it was', async () => {
    // One build records under one set of probes: a snapshot under others is another build's.
    await writeTestCoverage(into, { ...shardOf('story:local'), instrumentation: 'other-probes' });
    const held = await readFile(into);
    const shards = await written(shardOf('story:a'));

    const landing = landJourneys(home, shards, into);
    await expect(landing).rejects.toBeInstanceOf(OperatorError);
    await expect(landing).rejects.toThrow(
      new RegExp(`^the shards cannot be laid over the snapshot already at ${into}: .*\`other-probes\`.*\`fixture\`.*delete it and land again`, 'su'),
    );
    expect(Buffer.compare(await readFile(into), held)).toBe(0);
  });
});
