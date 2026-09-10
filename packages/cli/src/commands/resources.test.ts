import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TestCoverage } from '@variance-authority/sense/test-selection';
import { landJourneys } from './land.js';
import { recordedJourneys } from './resources.js';

/**
 * The reading of the execution journal that the lexicon draws its regions from.
 *
 * `journeyDivergences` decides what parted; this reads the other thing the
 * journal holds, which is every region every subject entered, whether or not
 * anyone else did. The instrument keeps that as one presence bit per region and
 * subject, and this is the fold that turns the bits back into a subject's list
 * of places, filtered to the subjects the run planned and sorted the same way
 * every other list in the report is.
 */

const { readTestCoverage, writeTestCoverage } = vi.hoisted(() => ({
  readTestCoverage: vi.fn(),
  writeTestCoverage: vi.fn(),
}));

const CACHED = '/cache/variance-authority/test-selection/abc/coverage.bin';

vi.mock('@variance-authority/sense/test-selection', async (importOriginal) => ({
  // The fold and the layer are the package's own; only the disk is stood in for.
  ...(await importOriginal<typeof import('@variance-authority/sense/test-selection')>()),
  testCoverageFile: () => CACHED,
  readTestCoverage,
  writeTestCoverage,
  journeyDivergences: () => [],
}));

afterEach(() => {
  readTestCoverage.mockReset();
  writeTestCoverage.mockReset();
});

const COVERAGE: TestCoverage = {
  version: 3,
  instrumentation: 'fixture',
  tests: [
    { file: 'story:cart-card--item', complete: true, preconditions: [] },
    { file: 'story:cart-card--removing', complete: true, preconditions: [] },
    { file: 'story:cart-card--verbose', complete: false, preconditions: [] },
  ],
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
          testFiles: ['story:cart-card--item', 'story:cart-card--removing', 'story:cart-card--verbose'],
        },
        {
          ordinal: 1,
          kind: 'handler',
          owner: 0,
          digest: 'block:1',
          name: 'CartCard/onClick',
          path: 'CartCard/onClick',
          startLine: 51,
          endLine: 58,
          source: true,
          testFiles: ['story:cart-card--removing'],
        },
        {
          // A synthesized control-flow region with no source of its own: not a
          // place anyone can name, so not a place anyone entered.
          ordinal: 2,
          kind: 'branch',
          owner: 0,
          digest: 'block:2',
          name: 'CartCard/else',
          path: 'if#1/else',
          startLine: 60,
          endLine: 60,
          source: false,
          testFiles: ['story:cart-card--item'],
        },
      ],
    },
    {
      // A module the build could not instrument says nothing about anyone.
      file: 'app/src/components/Price.tsx',
      sourceDigest: 'source:price',
      instrumented: false,
      blocks: [],
    },
  ],
};

describe('recordedJourneys — the regions each subject entered', () => {
  it('folds the presence bits into one sorted list of places per subject', async () => {
    readTestCoverage.mockResolvedValue(COVERAGE);

    const reading = await recordedJourneys('/repo');

    expect([...(reading.entered ?? [])]).toEqual([
      ['story:cart-card--item', ['CartCard']],
      ['story:cart-card--removing', ['CartCard', 'CartCard/onClick']],
      ['story:cart-card--verbose', ['CartCard']],
    ]);
  });

  it('keeps only the subjects the run planned when asked for them', async () => {
    readTestCoverage.mockResolvedValue(COVERAGE);

    const reading = await recordedJourneys('/repo', ['story:cart-card--removing', 'story:never-ran']);

    expect([...(reading.entered ?? []).keys()]).toEqual(['story:cart-card--removing']);
  });

  it('carries a truncated subject too, because its places were entered even if the count is not whole', async () => {
    readTestCoverage.mockResolvedValue(COVERAGE);

    const reading = await recordedJourneys('/repo');

    expect(reading.recorded?.truncated).toEqual(['story:cart-card--verbose']);
    expect(reading.entered?.get('story:cart-card--verbose')).toEqual(['CartCard']);
  });

  it('has no places at all when there is no journal, rather than an empty map', async () => {
    readTestCoverage.mockRejectedValue(Object.assign(new Error('no such file'), { code: 'ENOENT' }));

    const reading = await recordedJourneys('/repo');

    expect(reading.entered).toBeUndefined();
    expect(reading.recorded).toBeUndefined();
  });
});

describe('landJourneys — N shard snapshots into the one this repository reads', () => {
  const missing = () => Object.assign(new Error('no such file'), { code: 'ENOENT' });

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

  /** The disk: shards where they were named, and whatever is at the target. */
  function disk(files: Record<string, TestCoverage>) {
    readTestCoverage.mockImplementation(async (path: string) => {
      const found = files[path];
      if (found === undefined) throw missing();
      return found;
    });
  }

  it('folds the shards and lands the union in the cache, saying where it stands', async () => {
    disk({ '/ci/shard-1.bin': shardOf('story:a'), '/ci/shard-2.bin': shardOf('story:b') });

    const landed = await landJourneys('/repo', ['/ci/shard-1.bin', '/ci/shard-2.bin']);

    expect(landed).toEqual({ at: CACHED, shards: 2, commit: 'c0ffee', observations: 2, modules: 1 });
    expect(writeTestCoverage).toHaveBeenCalledTimes(1);
    const [at, written] = writeTestCoverage.mock.calls[0] as [string, TestCoverage];
    expect(at).toBe(CACHED);
    expect(written.tests.map((test) => test.file)).toEqual(['story:a', 'story:b']);
    expect(written.modules[0]?.blocks[0]?.testFiles).toEqual(['story:a', 'story:b']);
  });

  it('lands where --into says instead, and the reading is pointed there', async () => {
    disk({ '/ci/shard-1.bin': shardOf('story:a') });

    const landed = await landJourneys('/repo', ['/ci/shard-1.bin'], '/tmp/folded.bin');

    expect(landed.at).toBe('/tmp/folded.bin');
    expect(writeTestCoverage.mock.calls[0]?.[0]).toBe('/tmp/folded.bin');
  });

  it('layers the fold over what was already there, so a baseline lands under local evidence', async () => {
    // The runner's own rule. The result stands where the fold stands, retires
    // what the fold re-recorded whole, and keeps the local observation it did
    // not — a fetched baseline is a floor, not a replacement.
    disk({
      [CACHED]: shardOf('story:local', 'l0ca1'),
      '/ci/shard-1.bin': shardOf('story:a'),
      '/ci/shard-2.bin': shardOf('story:b'),
    });

    const landed = await landJourneys('/repo', ['/ci/shard-1.bin', '/ci/shard-2.bin']);

    expect(landed).toMatchObject({ commit: 'c0ffee', observations: 3 });
    const [, written] = writeTestCoverage.mock.calls[0] as [string, TestCoverage];
    expect(written.tests.map((test) => test.file)).toEqual(['story:a', 'story:b', 'story:local']);
  });

  it('refuses a shard that is not there, by name', async () => {
    disk({ '/ci/shard-1.bin': shardOf('story:a') });

    await expect(landJourneys('/repo', ['/ci/shard-1.bin', '/ci/shard-9.bin'])).rejects.toThrow(
      'there is no snapshot at /ci/shard-9.bin',
    );
    expect(writeTestCoverage).not.toHaveBeenCalled();
  });

  it('refuses shards that were not one run, in the fold\'s own words', async () => {
    disk({ '/ci/shard-1.bin': shardOf('story:a', 'c0ffee'), '/ci/shard-2.bin': shardOf('story:b', 'decaf0') });

    await expect(landJourneys('/repo', ['/ci/shard-1.bin', '/ci/shard-2.bin'])).rejects.toThrow(
      /\/ci\/shard-1\.bin and \/ci\/shard-2\.bin disagree about the commit/,
    );
    expect(writeTestCoverage).not.toHaveBeenCalled();
  });

  it('refuses to write over a snapshot it cannot read, rather than replacing it', async () => {
    readTestCoverage.mockImplementation(async (path: string) => {
      if (path === CACHED) throw new Error('not a variance-authority test coverage artifact');
      return shardOf('story:a');
    });

    await expect(landJourneys('/repo', ['/ci/shard-1.bin'])).rejects.toThrow(
      `the snapshot already at ${CACHED} could not be read`,
    );
    expect(writeTestCoverage).not.toHaveBeenCalled();
  });
});
