import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TestCoverage } from '@variance-authority/sense/test-selection';
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

const { readTestCoverage } = vi.hoisted(() => ({ readTestCoverage: vi.fn() }));

vi.mock('@variance-authority/sense/test-selection', () => ({
  testCoverageFile: () => '/cache/variance-authority/test-selection/abc/coverage.bin',
  readTestCoverage,
  journeyDivergences: () => [],
}));

afterEach(() => {
  readTestCoverage.mockReset();
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
